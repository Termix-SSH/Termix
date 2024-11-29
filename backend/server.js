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

  let conn = null; // Declare SSH client outside to manage lifecycle

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message); // Try parsing the incoming message as JSON

      // Check if message contains SSH connection details
      if (data.host && data.username && data.password) {
        if (conn) {
          conn.end(); // Close any previous connection before starting a new one
        }

        conn = new ssh2.Client(); // Create a new SSH connection instance

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

            // When the WebSocket client sends a message (from terminal input), forward it to the SSH stream
            ws.on('message', (message) => {
              console.log(`Received message from WebSocket: ${message}`);
              stream.write(message); // Write the message (input) to the SSH shell
            });
          });
        }).on('error', (err) => {
          console.log('SSH Connection Error: ', err);
          ws.send(`SSH Error: ${err}`);
        }).connect({
          host: data.host,       // Host provided from the client
          port: 22,              // Default SSH port
          username: data.username,  // Username provided from the client
          password: data.password,  // Password provided from the client
        });
      }
    } catch (error) {
      // If message is not valid JSON (i.e., terminal input), treat it as raw text and send it to SSH
      console.log('Received non-JSON message, sending to SSH session:', message);
      if (conn) {
        const stream = conn._stream; // Access the SSH stream directly
        if (stream && stream.writable) {
          stream.write(message); // Write raw input message to SSH stream
        }
      } else {
        console.error('SSH connection is not established yet.');
      }
    }
  });

  // Handle WebSocket close event
  ws.on('close', () => {
    console.log('WebSocket closed');
    if (conn) {
      conn.end(); // Close SSH connection when WebSocket client disconnects
    }
  });
});

// Start the WebSocket server on port 8081
server.listen(8081, () => {
  console.log('WebSocket server is listening on ws://localhost:8081');
});