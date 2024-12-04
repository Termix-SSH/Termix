import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import { FitAddon } from 'xterm-addon-fit'; // Import the fit addon
import './App.css'; // Custom CSS for styling

const App = () => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null); // Create a ref for the fit addon
  const socket = useRef(null);
  const inputBuffer = useRef('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isSideBarHidden, setIsSideBarHidden] = useState(false);

  useEffect(() => {
    // Initialize the terminal and the fit addon
    terminal.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
      },
      macOptionIsMeta: true,
      allowProposedApi: true,
    });

    // Initialize and attach the fit addon to the terminal
    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);

    terminal.current.open(terminalRef.current);

    terminal.current.onData((data) => {
      if (socket.current && socket.current.readyState === WebSocket.OPEN) {
        socket.current.send(data);
      }
    });

    // Resize terminal to fit the container initially
    fitAddon.current.fit();

    // Adjust terminal size on window resize
    window.addEventListener('resize', () => {
      fitAddon.current.fit();
    });

    return () => {
      terminal.current.dispose();
      if (socket.current) {
        socket.current.close();
      }
      window.removeEventListener('resize', () => {
        fitAddon.current.fit();
      });
    };
  }, []);

  const handleConnect = () => {
    socket.current = new WebSocket('ws://localhost:8081');

    socket.current.onopen = () => {
      terminal.current.writeln(`Connected to WebSocket server at ${host}`);
      socket.current.send(JSON.stringify({ host, username, password }));
      setIsConnected(true);
    };

    socket.current.onmessage = (event) => {
      terminal.current.write(event.data);
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

  const handleSideBarHiding = () => {
    setIsSideBarHidden((prevState) => !prevState);
  };

  return (
    <div className="app-container">
      <div className="main-content">
        <div className={`sidebar ${isSideBarHidden ? 'hidden' : ''}`}>
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

      {/* Hide button always positioned in the bottom-right corner */}
      <button
        className="hide-sidebar-button"
        onClick={handleSideBarHiding}
      >
        {isSideBarHidden ? '+' : '-'}
      </button>
    </div>
  );
};

export default App;