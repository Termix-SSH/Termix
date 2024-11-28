import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

const App = () => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const socket = useRef(null);
  const inputBuffer = useRef('');

  useEffect(() => {
    // Dynamically get the WebSocket URL
    const WEBSOCKET_URL = window.__ENV__?.WEBSOCKET_URL || 'ws://localhost:8081';

    // Initialize xterm.js Terminal
    terminal.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
      },
      macOptionIsMeta: true,
      allowProposedApi: true,
    });

    terminal.current.open(terminalRef.current);

    // Connect to the WebSocket server
    socket.current = new WebSocket(WEBSOCKET_URL);

    // WebSocket Event Handlers
    socket.current.onopen = () => {
      terminal.current.writeln('Connected to WebSocket server.');
    };

    socket.current.onmessage = (event) => {
      terminal.current.write(event.data);
    };

    socket.current.onerror = (error) => {
      terminal.current.writeln(`WebSocket error: ${error.message}`);
    };

    socket.current.onclose = () => {
      terminal.current.writeln('Disconnected from WebSocket server.');
    };

    // Handle terminal input
    terminal.current.onData((data) => {
      if (data === '\r') {
        if (inputBuffer.current.trim() !== '') {
          socket.current.send(inputBuffer.current + '\n');
        }
        inputBuffer.current = '';
      } else if (data === '\u007F') {
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          terminal.current.write('\b \b');
        }
      } else {
        inputBuffer.current += data;
        terminal.current.write(data);
      }
    });

    return () => {
      terminal.current.dispose();
      if (socket.current) {
        socket.current.close();
      }
    };
  }, []);

  return (
    <div>
      <h1>SSH Web Terminal</h1>
      <div ref={terminalRef} style={{ height: '80vh', width: '100%' }}></div>
    </div>
  );
};

export default App;