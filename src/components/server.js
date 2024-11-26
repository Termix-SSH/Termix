const WebSocket = require('ws');
const ssh2 = require('ssh2');
const http = require('http');

// Create an HTTP server to serve WebSocket connections
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running\n');
});

// Create a WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('WebSocket connection established');

  const conn = new ssh2.Client(); // Create a new SSH connection instance

  // When the SSH connection is ready
  conn.on('ready', () => {
    console.log('SSH Connection established');

    // Start an interactive shell session
    conn.shell((err, stream) => {
      if (err) {
        console.log(`SSH Error: ${err}`);
        ws.send(`Error: ${err}`);
        return;
      }

      // Handle data from SSH session
      stream.on('data', (data) => {
        console.log(`SSH Output: ${data}`);
        ws.send(data.toString()); // Send the SSH output back to WebSocket client
      });

      // Handle stream close event
      stream.on('close', () => {
        console.log('SSH stream closed');
        conn.end();
      });

      // When the WebSocket client sends a message, forward it to the SSH stream
      ws.on('message', (message) => {
        console.log(`Received message from WebSocket: ${message}`);
        stream.write(message + '\n'); // Write the message to the SSH shell
      });
    });
  }).on('error', (err) => {
    console.log('SSH Connection Error: ', err);
  }).connect({
    host: '164.152.19.153',         // Replace with your SSH host
    port: 22,                       // Default SSH port
    username: 'bugattiguy527',      // Replace with your SSH username
    password: 'bugatti$123',        // Replace with your SSH password or use private key
  });

  // Handle WebSocket close event
  ws.on('close', () => {
    console.log('WebSocket closed');
    conn.end(); // Close SSH connection when WebSocket client disconnects
  });
});

// Start the WebSocket server on port 3001
server.listen(3001, () => {
  console.log('WebSocket server is listening on ws://localhost:3001');
});