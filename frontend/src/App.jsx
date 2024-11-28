import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

const App = () => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const socket = useRef(null);
  const inputBuffer = useRef('');

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

    // Connect to the WebSocket server
    socket.current = new WebSocket('ws://localhost:8080/ws/');

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
        // On Enter
        if (inputBuffer.current.trim() !== '') {
          socket.current.send(inputBuffer.current + '\n'); // Send the buffer to the server
        }
        inputBuffer.current = ''; // Clear the buffer
      } else if (data === '\u007F') {
        // Handle Backspace
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          terminal.current.write('\b \b');
        }
      } else {
        // Append input to buffer and display
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