import { createRoot } from "react-dom/client"
import { Dashboard } from "./components/dashboard"
import "./styles/dashboard.css"

// Function to initialize the app
function initApp() {
  const container = document.getElementById("root")

  // Check if the container exists
  if (!container) {
    console.error("Could not find root element to mount React app")
    return
  }

  const root = createRoot(container)
  root.render(<Dashboard />)
}

// Check if the DOM is already loaded
if (document.readyState === "loading") {
  // If not, wait for it to load
  document.addEventListener("DOMContentLoaded", initApp)
} else {
  // If already loaded, initialize immediately
  initApp()
}

