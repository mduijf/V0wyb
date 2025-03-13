/**
 * Utility functions for WebSocket connections
 */

/**
 * Check if a WebSocket URL is valid
 * @param {string} url - WebSocket URL to check
 * @returns {boolean} - True if valid
 */
export function isValidWebSocketUrl(url) {
  return url && (url.startsWith("ws://") || url.startsWith("wss://"))
}

/**
 * Check if a WebSocket server is reachable
 * @param {string} url - WebSocket URL to check
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if reachable
 */
export function checkWebSocketServer(url, timeout = 3000) {
  return new Promise((resolve) => {
    if (!isValidWebSocketUrl(url)) {
      resolve(false)
      return
    }

    const ws = new WebSocket(url)
    let timeoutId

    ws.onopen = () => {
      clearTimeout(timeoutId)
      ws.close()
      resolve(true)
    }

    ws.onerror = () => {
      clearTimeout(timeoutId)
      resolve(false)
    }

    timeoutId = setTimeout(() => {
      ws.close()
      resolve(false)
    }, timeout)
  })
}

/**
 * Get WebSocket readyState as a string
 * @param {WebSocket} socket - WebSocket instance
 * @returns {string} - ReadyState as string
 */
export function getReadyStateString(socket) {
  if (!socket) return "CLOSED"

  switch (socket.readyState) {
    case WebSocket.CONNECTING:
      return "CONNECTING"
    case WebSocket.OPEN:
      return "OPEN"
    case WebSocket.CLOSING:
      return "CLOSING"
    case WebSocket.CLOSED:
      return "CLOSED"
    default:
      return "UNKNOWN"
  }
}

/**
 * Format a WebSocket close code as a string with description
 * @param {number} code - WebSocket close code
 * @returns {string} - Formatted description
 */
export function formatCloseCode(code) {
  const codes = {
    1000: "Normal Closure",
    1001: "Going Away",
    1002: "Protocol Error",
    1003: "Unsupported Data",
    1004: "Reserved",
    1005: "No Status Received",
    1006: "Abnormal Closure",
    1007: "Invalid Frame Payload Data",
    1008: "Policy Violation",
    1009: "Message Too Big",
    1010: "Mandatory Extension",
    1011: "Internal Server Error",
    1012: "Service Restart",
    1013: "Try Again Later",
    1014: "Bad Gateway",
    1015: "TLS Handshake",
  }

  return `${code} (${codes[code] || "Unknown"})`
}

/**
 * Generate a diagnostic report for WebSocket issues
 * @param {Object} params - Parameters
 * @param {string} params.url - WebSocket URL
 * @param {Object} params.error - Error object
 * @param {WebSocket} params.socket - WebSocket instance
 * @returns {Object} - Diagnostic report
 */
export function generateDiagnosticReport({ url, error, socket }) {
  const report = {
    timestamp: new Date().toISOString(),
    url,
    browserInfo: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    },
    connectionInfo: {
      readyState: socket ? getReadyStateString(socket) : "N/A",
      protocol: socket ? socket.protocol : "N/A",
    },
    error: error
      ? {
          message: error.message,
          name: error.name,
          stack: error.stack,
        }
      : null,
  }

  return report
}

/**
 * Save WebSocket connection settings to localStorage
 * @param {Object} settings - Connection settings
 */
export function saveConnectionSettings(settings) {
  try {
    localStorage.setItem("wyb_connection_settings", JSON.stringify(settings))
  } catch (error) {
    console.error("Error saving connection settings:", error)
  }
}

/**
 * Load WebSocket connection settings from localStorage
 * @returns {Object|null} - Connection settings or null if not found
 */
export function loadConnectionSettings() {
  try {
    const settings = localStorage.getItem("wyb_connection_settings")
    return settings ? JSON.parse(settings) : null
  } catch (error) {
    console.error("Error loading connection settings:", error)
    return null
  }
}

