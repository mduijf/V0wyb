const express = require("express")
const path = require("path")
const app = express()
const PORT = process.env.PORT || 8000

// Serve static files from the dashboard directory
app.use(express.static(path.join(__dirname)))

// Serve index.html for all routes to support client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`)
})

