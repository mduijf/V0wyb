/**
 * Enhanced WebSocket service for communicating with the WatchYourBack servers
 * Includes improved error handling, reconnection logic, and diagnostics
 *
 * @param {string} system - The system name ('kandidaten' or 'soy')
 * @returns {Object} - WebSocket service instance
 */
const createWebSocketService = (system) => {
  let socket = null
  let isConnected = false
  const messageHandlers = new Map()
  let reconnectTimeout = null
  let reconnectDelay = 1000 // Start with 1 second delay
  let url = ""
  let connectionError = null
  let connectionAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 5
  const MAX_RECONNECT_DELAY = 30000 // 30 seconds

  // Event listeners
  const eventListeners = {
    connect: [],
    disconnect: [],
    error: [],
    reconnect: [],
    message: [],
  }

  /**
   * Add an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  const addEventListener = (event, callback) => {
    if (eventListeners[event]) {
      eventListeners[event].push(callback)
    }
  }

  /**
   * Remove an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  const removeEventListener = (event, callback) => {
    if (eventListeners[event]) {
      const index = eventListeners[event].indexOf(callback)
      if (index !== -1) {
        eventListeners[event].splice(index, 1)
      }
    }
  }

  /**
   * Trigger an event
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  const triggerEvent = (event, data) => {
    if (eventListeners[event]) {
      eventListeners[event].forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in ${event} event listener:`, error)
        }
      })
    }
  }

  /**
   * Connect to the WebSocket server
   * @param {string} serverUrl - WebSocket URL
   * @param {Object} options - Connection options
   * @returns {Promise} - Resolves when connected
   */
  const connect = (serverUrl, options = {}) => {
    return new Promise((resolve, reject) => {
      if (socket) {
        disconnect()
      }

      // Reset connection error
      connectionError = null

      // Validate URL format
      if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
        const error = new Error(`Invalid WebSocket URL: ${serverUrl}. URL must start with ws:// or wss://`)
        console.error(`${system} ${error.message}`)
        connectionError = error
        triggerEvent("error", error)
        reject(error)
        return
      }

      url = serverUrl
      connectionAttempts++

      try {
        console.log(`${system} connecting to ${url}... (attempt ${connectionAttempts})`)
        socket = new WebSocket(url)

        // Set timeout for connection
        let connectionTimeout
        connectionTimeout = setTimeout(() => {
          if (!isConnected) {
            const error = new Error(`Connection timeout for ${url}`)
            console.error(`${system} ${error.message}`)
            connectionError = error
            triggerEvent("error", error)

            // Close socket if it's still connecting
            if (socket && socket.readyState === WebSocket.CONNECTING) {
              socket.close()
              socket = null
            }

            reject(error)
          }
        }, options.timeout || 10000) // 10 second default timeout

        socket.onopen = () => {
          console.log(`${system} WebSocket connected to ${url}`)
          isConnected = true
          connectionAttempts = 0 // Reset attempts on successful connection
          reconnectDelay = 1000 // Reset reconnect delay
          clearTimeout(connectionTimeout)
          triggerEvent("connect", { url })
          resolve()
        }

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            handleMessage(data)
            triggerEvent("message", data)
          } catch (error) {
            console.error(`Error parsing ${system} message:`, error)
            triggerEvent("error", {
              type: "parse_error",
              error,
              rawData: event.data,
            })
          }
        }

        socket.onclose = (event) => {
          console.log(`${system} WebSocket closed: code=${event.code}, reason=${event.reason || "No reason provided"}`)
          isConnected = false
          clearTimeout(connectionTimeout)
          triggerEvent("disconnect", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          })

          // Don't reconnect if closed cleanly (code 1000) or if noReconnect option is set
          if (event.code !== 1000 && !options.noReconnect) {
            // Only attempt reconnect if we haven't exceeded max attempts
            if (connectionAttempts < MAX_RECONNECT_ATTEMPTS || options.unlimitedReconnect) {
              scheduleReconnect()
            } else {
              console.log(`${system} Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
              triggerEvent("error", {
                type: "max_reconnect_attempts",
                message: `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
              })
            }
          }
        }

        socket.onerror = (error) => {
          // Create a more detailed error object
          const detailedError = {
            message: `WebSocket connection error to ${url}`,
            originalError: error,
            timestamp: new Date().toISOString(),
            system,
            url,
            readyState: socket ? socket.readyState : null,
          }

          console.error(`${system} WebSocket error:`, detailedError)
          connectionError = detailedError
          triggerEvent("error", detailedError)

          // Don't reject here, let onclose handle it
          // This prevents "Uncaught promise rejection" warnings
        }
      } catch (error) {
        console.error(`${system} Error creating WebSocket:`, error)
        connectionError = error
        clearTimeout(connectionTimeout)
        triggerEvent("error", error)
        reject(error)
      }
    })
  }

  /**
   * Disconnect from the WebSocket server
   */
  const disconnect = () => {
    if (socket) {
      try {
        // Only close if not already closing or closed
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "Disconnected by client")
        }
      } catch (error) {
        console.error(`${system} Error closing WebSocket:`, error)
        triggerEvent("error", {
          type: "disconnect_error",
          error,
        })
      } finally {
        socket = null
        isConnected = false
      }
    }

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  const scheduleReconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }

    reconnectTimeout = setTimeout(() => {
      console.log(`Attempting to reconnect to ${system} server at ${url}...`)
      triggerEvent("reconnect", {
        attempt: connectionAttempts,
        delay: reconnectDelay,
        url,
      })

      connect(url).catch((error) => {
        console.log(`Reconnection attempt failed: ${error.message}`)
        // Increase reconnect delay with exponential backoff, max 30 seconds
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY)
      })
    }, reconnectDelay)
  }

  /**
   * Send a message to the server
   * @param {Object} message - Message to send
   * @returns {Promise} - Resolves when message is sent
   */
  const send = (message) => {
    return new Promise((resolve, reject) => {
      if (!isConnected) {
        const error = new Error(`${system} WebSocket not connected`)
        console.error(error.message)
        triggerEvent("error", {
          type: "send_error",
          error,
          message,
        })
        reject(error)
        return
      }

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        const error = new Error(`${system} WebSocket not in OPEN state`)
        console.error(error.message)
        triggerEvent("error", {
          type: "send_error",
          error,
          message,
          readyState: socket ? socket.readyState : null,
        })
        reject(error)
        return
      }

      try {
        const messageStr = JSON.stringify(message)
        socket.send(messageStr)
        resolve()
      } catch (error) {
        console.error(`Error sending ${system} message:`, error)
        triggerEvent("error", {
          type: "send_error",
          error,
          message,
        })
        reject(error)
      }
    })
  }

  /**
   * Register a message handler
   * @param {string} messageType - Type of message to handle
   * @param {Function} handler - Handler function
   */
  const onMessage = (messageType, handler) => {
    if (!messageHandlers.has(messageType)) {
      messageHandlers.set(messageType, [])
    }
    messageHandlers.get(messageType).push(handler)
  }

  /**
   * Remove a message handler
   * @param {string} messageType - Type of message
   * @param {Function} handler - Handler function to remove
   */
  const offMessage = (messageType, handler) => {
    if (messageHandlers.has(messageType)) {
      const handlers = messageHandlers.get(messageType)
      const index = handlers.indexOf(handler)
      if (index !== -1) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * Handle an incoming message
   * @param {Object} data - Message data
   */
  const handleMessage = (data) => {
    const messageType = data.type

    if (messageHandlers.has(messageType)) {
      messageHandlers.get(messageType).forEach((handler) => {
        try {
          handler(data)
        } catch (error) {
          console.error(`Error in ${system} message handler:`, error)
          triggerEvent("error", {
            type: "handler_error",
            error,
            messageType,
            data,
          })
        }
      })
    }
  }

  /**
   * Get clients from the server
   * @param {Object} options - Request options
   * @returns {Promise} - Resolves when clients are received
   */
  const getClients = (options = {}) => {
    return new Promise((resolve, reject) => {
      if (!isConnected) {
        reject(new Error(`${system} WebSocket not connected`))
        return
      }

      const messageType = "client_list"
      let timeoutId

      // One-time handler for the response
      const handler = (data) => {
        // Remove this handler after execution
        const handlers = messageHandlers.get(messageType)
        const index = handlers.indexOf(handler)
        if (index !== -1) {
          handlers.splice(index, 1)
        }

        // Clear timeout
        clearTimeout(timeoutId)

        resolve(data.clients || {})
      }

      // Register handler
      onMessage(messageType, handler)

      // Set timeout for response
      timeoutId = setTimeout(() => {
        // Remove handler if it's still registered
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        reject(new Error(`Timeout waiting for ${messageType} response`))
      }, options.timeout || 5000) // 5 second timeout

      // Send request
      send({ type: "get_clients" }).catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Get presets from the server
   * @param {Object} options - Request options
   * @returns {Promise} - Resolves when presets are received
   */
  const getPresets = (options = {}) => {
    return new Promise((resolve, reject) => {
      if (!isConnected) {
        reject(new Error(`${system} WebSocket not connected`))
        return
      }

      const messageType = "preset_list"
      let timeoutId

      // One-time handler for the response
      const handler = (data) => {
        // Remove this handler after execution
        const handlers = messageHandlers.get(messageType)
        const index = handlers.indexOf(handler)
        if (index !== -1) {
          handlers.splice(index, 1)
        }

        // Clear timeout
        clearTimeout(timeoutId)

        resolve(data.presets || [])
      }

      // Register handler
      onMessage(messageType, handler)

      // Set timeout for response
      timeoutId = setTimeout(() => {
        // Remove handler if it's still registered
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        reject(new Error(`Timeout waiting for ${messageType} response`))
      }, options.timeout || 5000) // 5 second timeout

      // Send request
      send({ type: "get_presets" }).catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Update display settings for clients
   * @param {Array} clientIds - Client IDs to update
   * @param {Object} displayData - Display settings
   * @param {Object} options - Request options
   * @returns {Promise} - Resolves when update is sent
   */
  const updateDisplay = (clientIds, displayData, options = {}) => {
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return Promise.reject(new Error("Client IDs must be a non-empty array"))
    }

    if (!displayData || typeof displayData !== "object") {
      return Promise.reject(new Error("Display data must be an object"))
    }

    return new Promise((resolve, reject) => {
      const messageType = "display_updated"
      let timeoutId

      // One-time handler for the response
      const handler = (data) => {
        // Remove this handler after execution
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        // Clear timeout
        clearTimeout(timeoutId)

        resolve(data)
      }

      // Register handler
      onMessage(messageType, handler)

      // Set timeout for response
      timeoutId = setTimeout(() => {
        // Remove handler if it's still registered
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        reject(new Error(`Timeout waiting for ${messageType} response`))
      }, options.timeout || 5000) // 5 second timeout

      // Send request
      send({
        type: "update_display",
        clients: clientIds,
        display: displayData,
      }).catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Save a preset
   * @param {string} name - Preset name
   * @param {Object} options - Request options
   * @returns {Promise} - Resolves when preset is saved
   */
  const savePreset = (name, options = {}) => {
    if (!name || typeof name !== "string") {
      return Promise.reject(new Error("Preset name must be a non-empty string"))
    }

    return new Promise((resolve, reject) => {
      const messageType = "preset_saved"
      let timeoutId

      // One-time handler for the response
      const handler = (data) => {
        // Remove this handler after execution
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        // Clear timeout
        clearTimeout(timeoutId)

        resolve(data)
      }

      // Register handler
      onMessage(messageType, handler)

      // Set timeout for response
      timeoutId = setTimeout(() => {
        // Remove handler if it's still registered
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        reject(new Error(`Timeout waiting for ${messageType} response`))
      }, options.timeout || 5000) // 5 second timeout

      // Send request
      send({
        type: "save_preset",
        name,
      }).catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Load a preset
   * @param {string} name - Preset name
   * @param {Object} options - Request options
   * @returns {Promise} - Resolves when preset is loaded
   */
  const loadPreset = (name, options = {}) => {
    if (!name || typeof name !== "string") {
      return Promise.reject(new Error("Preset name must be a non-empty string"))
    }

    return new Promise((resolve, reject) => {
      const messageType = "preset_loaded"
      let timeoutId

      // One-time handler for the response
      const handler = (data) => {
        // Remove this handler after execution
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        // Clear timeout
        clearTimeout(timeoutId)

        resolve(data)
      }

      // Register handler
      onMessage(messageType, handler)

      // Set timeout for response
      timeoutId = setTimeout(() => {
        // Remove handler if it's still registered
        const handlers = messageHandlers.get(messageType)
        if (handlers) {
          const index = handlers.indexOf(handler)
          if (index !== -1) {
            handlers.splice(index, 1)
          }
        }

        reject(new Error(`Timeout waiting for ${messageType} response`))
      }, options.timeout || 5000) // 5 second timeout

      // Send request
      send({
        type: "load_preset",
        name,
      }).catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * Check connection status
   * @returns {Object} - Connection status information
   */
  const getConnectionStatus = () => {
    return {
      connected: isConnected,
      url,
      error: connectionError,
      socketState: socket ? socket.readyState : null,
      reconnectAttempts: connectionAttempts,
      system,
    }
  }

  /**
   * Get diagnostic information
   * @returns {Object} - Diagnostic information
   */
  const getDiagnostics = () => {
    return {
      system,
      url,
      connected: isConnected,
      socketState: socket ? socket.readyState : null,
      socketProtocol: socket ? socket.protocol : null,
      error: connectionError,
      reconnectAttempts: connectionAttempts,
      reconnectDelay,
      messageHandlers: Array.from(messageHandlers.keys()),
      eventListeners: {
        connect: eventListeners.connect.length,
        disconnect: eventListeners.disconnect.length,
        error: eventListeners.error.length,
        reconnect: eventListeners.reconnect.length,
        message: eventListeners.message.length,
      },
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    }
  }

  // Return the public API
  return {
    connect,
    disconnect,
    send,
    onMessage,
    offMessage,
    getClients,
    getPresets,
    updateDisplay,
    savePreset,
    loadPreset,
    getConnectionStatus,
    getDiagnostics,
    addEventListener,
    removeEventListener,
    get isConnected() {
      return isConnected
    },
    get socket() {
      return socket
    },
  }
}

export default createWebSocketService

