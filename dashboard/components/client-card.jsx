"use client"

import { useState, useEffect } from "react"

export function ClientCard({ client, onUpdate, onSelect, isSelected, isConnected = true }) {
  const [number, setNumber] = useState(client.display?.number || "")
  const [mode, setMode] = useState(client.display?.mode || "color")
  const [background, setBackground] = useState(client.display?.background || "#000000")
  const [image, setImage] = useState(client.display?.image || "")
  const [localImages, setLocalImages] = useState([])
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(null)

  // Load local images when component mounts
  useEffect(() => {
    // This would be replaced with an actual API call in production
    const dummyImages = [
      { name: "image1.jpg", url: "/images/image1.jpg" },
      { name: "image2.jpg", url: "/images/image2.jpg" },
    ]
    setLocalImages(dummyImages)
  }, [])

  // Update local state when client props change
  useEffect(() => {
    if (client.display) {
      setNumber(client.display.number || "")
      setMode(client.display.mode || "color")
      setBackground(client.display.background || "#000000")
      setImage(client.display.image || "")
    }
  }, [client])

  const handleUpdate = async () => {
    if (!isConnected) {
      setUpdateError("Not connected to server")
      setTimeout(() => setUpdateError(null), 3000)
      return
    }

    setIsUpdating(true)
    setUpdateError(null)

    try {
      await onUpdate(client.id, {
        mode,
        background,
        number,
        image: mode === "image" ? image : "",
      })
      // Success feedback could be added here
    } catch (error) {
      console.error("Error updating client:", error)
      setUpdateError(error.message || "Failed to update display")
    } finally {
      setIsUpdating(false)
    }
  }

  const handleModeChange = (newMode) => {
    setMode(newMode)
  }

  const handleColorSelect = (color) => {
    setBackground(color)
  }

  const handleImageSelect = (imageUrl) => {
    setImage(imageUrl)
  }

  return (
    <div className={`client-card ${isSelected ? "selected" : ""}`}>
      <div className="card-header">
        <input
          type="checkbox"
          className="select-checkbox"
          checked={isSelected}
          onChange={(e) => onSelect(client.id, e.target.checked)}
        />
        <div className="client-name">{client.info?.name || client.id.substring(0, 8)}</div>
        <div className={`client-status status-${client.status || "offline"}`}>{client.status || "offline"}</div>
      </div>

      <div
        className="preview"
        style={{
          backgroundColor: mode === "color" ? background : "#000000",
          backgroundImage: mode === "image" && image ? `url(${image})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="preview-number">{number}</div>
      </div>

      <div className="mode-selector">
        <div className={`mode-btn ${mode === "color" ? "active" : ""}`} onClick={() => handleModeChange("color")}>
          Color
        </div>
        <div className={`mode-btn ${mode === "image" ? "active" : ""}`} onClick={() => handleModeChange("image")}>
          Image
        </div>
      </div>

      {mode === "color" && (
        <div className="color-options">
          <div className="color-buttons">
            <button className="color-btn red-btn" onClick={() => handleColorSelect("#ff2600")}>
              Red
            </button>
            <button className="color-btn blue-btn" onClick={() => handleColorSelect("#0061ff")}>
              Blue
            </button>
            <input
              type="color"
              value={background}
              onChange={(e) => handleColorSelect(e.target.value)}
              className="color-picker"
            />
          </div>
        </div>
      )}

      {mode === "image" && (
        <div className="image-options">
          <div className="local-images">
            <div className="local-images-header">Local Images:</div>
            <div className="image-grid">
              {localImages.map((img) => (
                <div
                  key={img.name}
                  className={`image-thumb ${image === img.url ? "selected" : ""}`}
                  style={{ backgroundImage: `url(${img.url})` }}
                  onClick={() => handleImageSelect(img.url)}
                  title={img.name}
                />
              ))}
            </div>
          </div>
          <input
            type="text"
            className="image-input"
            placeholder="Image URL"
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
        </div>
      )}

      <input
        type="text"
        className="number-input"
        placeholder="Number"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />

      <button
        className={`update-btn ${isUpdating ? "updating" : ""}`}
        onClick={handleUpdate}
        disabled={isUpdating || !isConnected}
      >
        {isUpdating ? "Updating..." : "Update Display"}
      </button>

      {updateError && <div className="update-error">{updateError}</div>}
    </div>
  )
}

