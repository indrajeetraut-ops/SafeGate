const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from the current directory (HTML, CSS, JS)
app.use(express.static(__dirname));

// Direct any missing paths to our main app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 SafeGate Node.js server running...`);
    console.log(`👉 Access URL: http://localhost:${PORT}`);
    console.log(`👉 Press Ctrl+C to stop.`);
});
