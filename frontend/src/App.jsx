import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import './App.css'; // Custom CSS for styling

const App = () => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const socket = useRef(null);
  const inputBuffer = useRef('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize xterm.js Terminal
    terminal.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
      },
      macOptionIsMeta: true, // Enable Meta key for Mac users
      allowProposedApi: true, // Allow advanced terminal features
    });

    terminal.current.open(terminalRef.current);

    // Listen for key events and send them to WebSocket
    terminal.current.onData((data) => {
      if (socket.current && socket.current.readyState === WebSocket.OPEN) {
        socket.current.send(data); // Send typed data to the server
      }
    });

    return () => {
      terminal.current.dispose();
      if (socket.current) {
        socket.current.close();
      }
    };
  }, []);

  const handleConnect = () => {
    // Establish WebSocket connection
    socket.current = new WebSocket('ws://localhost:8081');

    socket.current.onopen = () => {
      terminal.current.writeln(`Connected to WebSocket server at ${host}`);
      // Send the SSH connection credentials once connected
      socket.current.send(JSON.stringify({ host, username, password }));
      setIsConnected(true);
    };

    socket.current.onmessage = (event) => {
      terminal.current.write(event.data); // Write server response to terminal
    };

    socket.current.onerror = (error) => {
      terminal.current.writeln(`WebSocket error: ${error.message}`);
    };

    socket.current.onclose = () => {
      terminal.current.writeln('Disconnected from WebSocket server.');
      setIsConnected(false);
    };
  };

  const handleInputChange = (event, setState) => {
    setState(event.target.value);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>SSH Web Terminal</h1>
      </header>

      <div className="main-content">
        <div className="sidebar">
          <h2>Connection Details</h2>
          <input
            type="text"
            placeholder="Host"
            value={host}
            onChange={(e) => handleInputChange(e, setHost)}
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => handleInputChange(e, setUsername)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => handleInputChange(e, setPassword)}
          />
          <button onClick={handleConnect} disabled={isConnected}>
            {isConnected ? 'Connected' : 'Start Session'}
          </button>
        </div>

        <div ref={terminalRef} className="terminal-container"></div>
      </div>
    </div>
  );
};

export default App;