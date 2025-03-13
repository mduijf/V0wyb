"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { ClientCard } from "./client-card"
import { ConnectionManager } from "./connection-manager"
import createWebSocketService from "../services/websocket-service"
import {
  checkWebSocketServer,
  saveConnectionSettings,
  loadConnectionSettings,
  generateDiagnosticReport,
} from "../utils/websocket-utils"

// Mock data for development/testing when server is unavailable
const MOCK_MODE = false // Set to true to use mock data
const MOCK_CLIENTS = {
  client1: {
    info: { name: "Display 1" },
    status: "online",
    display: { mode: "color", background: "#000000", number: "1" },
  },
  client2: {
    info: { name: "Display 2" },
    status: "online",
    display: { mode: "color", background: "#ff2600", number: "2" },
  },
}
const MOCK_PRESETS = ["Default", "Red Screens", "Blue Screens"]

export function Dashboard() {
  const [clients, setClients] = useState({})
  const [selectedClients, setSelectedClients] = useState([])
  const [presets, setPresets] = useState([])
  const [newPresetName, setNewPresetName] = useState("")
  const [connectionStatus, setConnectionStatus] = useState("disconnected")
  const [connectionError, setConnectionError] = useState(null)
  const [kandidatenService, setKandidatenService] = useState(null)
  const [soyService, setSoyService] = useState(null)
  const [serverUrl, setServerUrl] = useState("")
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [diagnosticInfo, setDiagnosticInfo] = useState(null)

  // Reference to track if component is mounted
  const isMounted = useRef(true)

  // Load saved connection settings on mount
  useEffect(() => {
    const savedSettings = loadConnectionSettings()
    if (savedSettings && savedSettings.serverUrl) {
      setServerUrl(savedSettings.serverUrl)
    } else {
      // Default URL if no saved settings
      setServerUrl("ws://localhost:8765")
    }

    return () => {
      isMounted.current = false
    }
  }, [])

  // Function to refresh client data
  const refreshClients = useCallback(async () => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      if (MOCK_MODE) {
        setClients(MOCK_CLIENTS)
      }
      return
    }

    try {
      const clientsData = await kandidatenService.getClients()
      if (isMounted.current) {
        setClients(clientsData)
      }
    } catch (error) {
      console.error("Error fetching clients:", error)
      // If in mock mode, use mock data as fallback
      if (MOCK_MODE && isMounted.current) {
        setClients(MOCK_CLIENTS)
      }
    }
  }, [kandidatenService])

  // Function to refresh preset data
  const refreshPresets = useCallback(async () => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      if (MOCK_MODE) {
        setPresets(MOCK_PRESETS)
      }
      return
    }

    try {
      const presetsData = await kandidatenService.getPresets()
      if (isMounted.current) {
        setPresets(presetsData)
      }
    } catch (error) {
      console.error("Error fetching presets:", error)
      // If in mock mode, use mock data as fallback
      if (MOCK_MODE && isMounted.current) {
        setPresets(MOCK_PRESETS)
      }
    }
  }, [kandidatenService])

  // Function to connect to the server
  const connectToServer = useCallback(
    async (url) => {
      if (!url) return

      try {
        setIsLoading(true)
        setConnectionStatus("connecting")
        setConnectionError(null)
        setDiagnosticInfo(null)

        // Check if server is reachable first
        const isReachable = await checkWebSocketServer(url)

        if (!isReachable) {
          throw new Error(`Server at ${url} is not reachable`)
        }

        // Create new service instances
        const kandidaten = createWebSocketService("kandidaten")
        setKandidatenService(kandidaten)

        const soy = createWebSocketService("soy")
        setSoyService(soy)

        // Set up message handlers
        kandidaten.onMessage("client_list", (data) => {
          if (isMounted.current) {
            setClients((prevClients) => ({
              ...prevClients,
              ...data.clients,
            }))
          }
        })

        kandidaten.onMessage("preset_list", (data) => {
          if (isMounted.current) {
            setPresets(data.presets || [])
          }
        })

        // Set up event listeners
        kandidaten.addEventListener("error", (error) => {
          console.error("Kandidaten error event:", error)
          if (isMounted.current) {
            setDiagnosticInfo((prev) => ({
              ...prev,
              lastError: error,
            }))
          }
        })

        // Connect to Kandidaten server
        await kandidaten.connect(url, { timeout: 5000 })

        // Save successful connection settings
        saveConnectionSettings({ serverUrl: url })

        // Try to connect to Soy server (optional)
        const soyUrl = url.replace("8765", "8766")
        try {
          await soy.connect(soyUrl, { timeout: 5000, noReconnect: true })
        } catch (error) {
          console.warn("Could not connect to Soy server:", error)
          // This is not critical, so we continue
        }

        if (isMounted.current) {
          setConnectionStatus("connected")
          setIsConfigOpen(false)
        }

        // Get initial data
        await refreshClients()
        await refreshPresets()
      } catch (error) {
        console.error("Connection error:", error)

        // Generate diagnostic information
        const diagnostics = generateDiagnosticReport({
          url,
          error,
          socket: kandidatenService?.socket,
        })

        if (isMounted.current) {
          setConnectionStatus("error")
          setConnectionError(error.message || "Unknown connection error")
          setDiagnosticInfo(diagnostics)

          // If in mock mode, use mock data
          if (MOCK_MODE) {
            setClients(MOCK_CLIENTS)
            setPresets(MOCK_PRESETS)
            // Simulate connected state for UI testing
            setConnectionStatus("connected")
          }
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false)
        }
      }
    },
    [refreshClients, refreshPresets],
  )

  // Initialize WebSocket services when serverUrl is available
  useEffect(() => {
    if (serverUrl) {
      connectToServer(serverUrl)
    }

    // Cleanup on unmount
    return () => {
      if (kandidatenService) kandidatenService.disconnect()
      if (soyService) soyService.disconnect()
    }
  }, [connectToServer, serverUrl])

  // Set up periodic refresh
  useEffect(() => {
    if (connectionStatus === "connected") {
      const refreshInterval = setInterval(() => {
        refreshClients()
      }, 10000) // Refresh every 10 seconds

      return () => clearInterval(refreshInterval)
    }
  }, [connectionStatus, refreshClients])

  // Handle client selection
  const handleClientSelect = (clientId, isSelected) => {
    setSelectedClients((prev) => {
      if (isSelected && !prev.includes(clientId)) {
        return [...prev, clientId]
      } else if (!isSelected && prev.includes(clientId)) {
        return prev.filter((id) => id !== clientId)
      }
      return prev
    })
  }

  // Handle client update
  const handleClientUpdate = async (clientId, displayData) => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      throw new Error("Not connected to server")
    }

    try {
      await kandidatenService.updateDisplay([clientId], displayData)
      // Refresh clients after update
      setTimeout(refreshClients, 500)
    } catch (error) {
      console.error("Error updating client:", error)
      throw error
    }
  }

  // Handle preset save
  const handleSavePreset = async () => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      alert("Not connected to server. Cannot save preset.")
      return
    }

    if (!newPresetName.trim()) {
      alert("Please enter a preset name.")
      return
    }

    try {
      await kandidatenService.savePreset(newPresetName)
      setNewPresetName("")
      await refreshPresets()
    } catch (error) {
      console.error("Error saving preset:", error)
      alert(`Error saving preset: ${error.message}`)
    }
  }

  // Handle preset load
  const handleLoadPreset = async (presetName) => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      alert("Not connected to server. Cannot load preset.")
      return
    }

    try {
      await kandidatenService.loadPreset(presetName)
      // Refresh clients after loading preset
      setTimeout(refreshClients, 500)
    } catch (error) {
      console.error("Error loading preset:", error)
      alert(`Error loading preset: ${error.message}`)
    }
  }

  // Handle bulk update
  const handleBulkUpdate = async (displayData) => {
    if (!kandidatenService || !kandidatenService.isConnected) {
      alert("Not connected to server. Cannot update clients.")
      return
    }

    if (selectedClients.length === 0) {
      alert("Please select at least one client.")
      return
    }

    try {
      await kandidatenService.updateDisplay(selectedClients, displayData)
      // Refresh clients after update
      setTimeout(refreshClients, 500)
    } catch (error) {
      console.error("Error updating clients:", error)
      alert(`Error updating clients: ${error.message}`)
    }
  }

  // Handle server URL change
  const handleServerUrlChange = (e) => {
    setServerUrl(e.target.value)
  }

  // Handle disconnect
  const handleDisconnect = () => {
    if (kandidatenService) kandidatenService.disconnect()
    if (soyService) soyService.disconnect()
    setConnectionStatus("disconnected")
    setClients({})
    setPresets([])
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>WatchYourBack Control Panel</h1>
        <div className="connection-controls">
          <div
            className={`connection-status status-${connectionStatus}`}
            onClick={() => setIsConfigOpen(!isConfigOpen)}
            title="Click to configure connection"
          >
            {connectionStatus}
          </div>
          <button
            className="refresh-btn"
            onClick={refreshClients}
            disabled={connectionStatus !== "connected"}
            title="Refresh client data"
          >
            ↻
          </button>
        </div>
      </header>

      {isConfigOpen && (
        <ConnectionManager
          connectionStatus={connectionStatus}
          serverUrl={serverUrl}
          onServerUrlChange={handleServerUrlChange}
          onConnect={() => connectToServer(serverUrl)}
          onDisconnect={handleDisconnect}
          diagnosticInfo={diagnosticInfo}
          isLoading={isLoading}
        />
      )}

      <div className="dashboard-controls">
        <div className="presets-panel">
          <h2>Presets</h2>
          <div className="preset-list">
            {presets.length > 0 ? (
              presets.map((preset) => (
                <button
                  key={preset}
                  className="preset-btn"
                  onClick={() => handleLoadPreset(preset)}
                  disabled={connectionStatus !== "connected"}
                >
                  {preset}
                </button>
              ))
            ) : (
              <div className="no-presets">{isLoading ? "Loading presets..." : "No presets available"}</div>
            )}
          </div>
          <div className="save-preset">
            <input
              type="text"
              placeholder="New preset name"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              disabled={connectionStatus !== "connected"}
            />
            <button onClick={handleSavePreset} disabled={connectionStatus !== "connected" || !newPresetName.trim()}>
              Save
            </button>
          </div>
        </div>

        <div className="bulk-controls">
          <h2>Bulk Controls ({selectedClients.length} selected)</h2>
          <div className="bulk-buttons">
            <button
              onClick={() => handleBulkUpdate({ mode: "color", background: "#000000" })}
              disabled={connectionStatus !== "connected" || selectedClients.length === 0}
            >
              Black
            </button>
            <button
              onClick={() => handleBulkUpdate({ mode: "color", background: "#ff2600" })}
              disabled={connectionStatus !== "connected" || selectedClients.length === 0}
            >
              Red
            </button>
            <button
              onClick={() => handleBulkUpdate({ mode: "color", background: "#0061ff" })}
              disabled={connectionStatus !== "connected" || selectedClients.length === 0}
            >
              Blue
            </button>
            <button
              onClick={() => handleBulkUpdate({ number: "" })}
              disabled={connectionStatus !== "connected" || selectedClients.length === 0}
            >
              Clear Numbers
            </button>
          </div>
        </div>
      </div>

      <div className="clients-grid">
        {isLoading ? (
          <div className="loading-clients">Loading clients...</div>
        ) : Object.keys(clients).length > 0 ? (
          Object.entries(clients).map(([clientId, client]) => (
            <ClientCard
              key={clientId}
              client={{ ...client, id: clientId }}
              onUpdate={handleClientUpdate}
              onSelect={handleClientSelect}
              isSelected={selectedClients.includes(clientId)}
              isConnected={connectionStatus === "connected"}
            />
          ))
        ) : (
          <div className="no-clients">
            {connectionStatus === "connected" ? "No clients connected" : "Connect to server to view clients"}
          </div>
        )}
      </div>
    </div>
  )
}

