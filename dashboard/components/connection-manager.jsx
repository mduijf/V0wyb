"use client"

import { useState, useEffect } from "react"

export function ConnectionManager({
  connectionStatus,
  serverUrl,
  onServerUrlChange,
  onConnect,
  onDisconnect,
  diagnosticInfo,
  isLoading,
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [savedUrls, setSavedUrls] = useState([])
  const [showSavedUrls, setShowSavedUrls] = useState(false)

  // Load saved URLs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("wyb_saved_urls")
      if (saved) {
        setSavedUrls(JSON.parse(saved))
      }
    } catch (error) {
      console.error("Error loading saved URLs:", error)
    }
  }, [])

  // Save a URL to localStorage
  const saveUrl = () => {
    if (!serverUrl || savedUrls.includes(serverUrl)) return

    const newSavedUrls = [...savedUrls, serverUrl]
    setSavedUrls(newSavedUrls)

    try {
      localStorage.setItem("wyb_saved_urls", JSON.stringify(newSavedUrls))
    } catch (error) {
      console.error("Error saving URL:", error)
    }
  }

  // Remove a saved URL
  const removeUrl = (url) => {
    const newSavedUrls = savedUrls.filter((u) => u !== url)
    setSavedUrls(newSavedUrls)

    try {
      localStorage.setItem("wyb_saved_urls", JSON.stringify(newSavedUrls))
    } catch (error) {
      console.error("Error removing URL:", error)
    }
  }

  // Select a saved URL
  const selectUrl = (url) => {
    onServerUrlChange({ target: { value: url } })
    setShowSavedUrls(false)
  }

  // Copy diagnostics to clipboard
  const copyDiagnostics = () => {
    if (diagnosticInfo) {
      navigator.clipboard
        .writeText(JSON.stringify(diagnosticInfo, null, 2))
        .then(() => alert("Diagnostic information copied to clipboard"))
        .catch((err) => console.error("Failed to copy diagnostics:", err))
    }
  }

  return (
    <div className="connection-config">
      <div className="config-row">
        <label htmlFor="server-url">Server URL:</label>
        <div className="url-input-container">
          <input
            id="server-url"
            type="text"
            value={serverUrl}
            onChange={onServerUrlChange}
            placeholder="ws://localhost:8765"
          />
          <button className="url-dropdown-btn" onClick={() => setShowSavedUrls(!showSavedUrls)} title="Show saved URLs">
            ▼
          </button>
          {showSavedUrls && savedUrls.length > 0 && (
            <div className="saved-urls-dropdown">
              {savedUrls.map((url) => (
                <div key={url} className="saved-url-item">
                  <span onClick={() => selectUrl(url)}>{url}</span>
                  <button className="remove-url-btn" onClick={() => removeUrl(url)} title="Remove URL">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {connectionStatus === "connected" ? (
          <button onClick={onDisconnect} className="disconnect-btn">
            Disconnect
          </button>
        ) : (
          <button onClick={onConnect} disabled={isLoading} className="connect-btn">
            {isLoading ? "Connecting..." : "Connect"}
          </button>
        )}
        {connectionStatus === "connected" && (
          <button onClick={saveUrl} className="save-url-btn" title="Save this URL">
            Save URL
          </button>
        )}
      </div>

      {connectionStatus === "error" && (
        <div className="connection-error">
          <div className="error-message">{diagnosticInfo?.error?.message || "Connection error"}</div>
          <div className="diagnostics-controls">
            <button onClick={() => setShowDiagnostics(!showDiagnostics)} className="diagnostics-toggle">
              {showDiagnostics ? "Hide Diagnostics" : "Show Diagnostics"}
            </button>
            <button onClick={copyDiagnostics} className="diagnostics-copy">
              Copy Diagnostics
            </button>
          </div>
          {showDiagnostics && diagnosticInfo && (
            <pre className="diagnostics-info">{JSON.stringify(diagnosticInfo, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

