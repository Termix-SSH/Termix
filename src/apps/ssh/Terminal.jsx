import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import io from "socket.io-client";
import PropTypes from "prop-types";
import theme from "../../theme.js";

export const NewTerminal = forwardRef(({ hostConfig, isVisible, setIsNoAuthHidden }, ref) => {
    const terminalRef = useRef(null);
    const socketRef = useRef(null);
    const fitAddon = useRef(new FitAddon());
    const terminalInstance = useRef(null);

    const resizeTerminal = () => {
        const terminalContainer = terminalRef.current;
        const parentContainer = terminalContainer?.parentElement;

        if (!parentContainer || parentContainer.clientWidth === 0) return;

        const parentWidth = parentContainer.clientWidth - 8;
        const parentHeight = parentContainer.clientHeight - 12;

        terminalContainer.style.width = `${parentWidth}px`;
        terminalContainer.style.height = `${parentHeight}px`;

        requestAnimationFrame(() => {
            if (fitAddon.current && terminalInstance.current) {
                fitAddon.current.fit();
                
                if (socketRef.current) {
                    let { cols, rows } = terminalInstance.current;
                    const originalCols = cols;
                    const originalRows = rows;
                    
                    cols += 1;
                    
                    try {
                        terminalInstance.current.resize(cols, rows);
                        socketRef.current.emit("resize", { cols, rows });
                    } catch (e) {
                        terminalInstance.current.resize(originalCols, originalRows);
                        socketRef.current.emit("resize", { cols: originalCols, rows: originalRows });
                    }
                }
            }
        });
    };

    useImperativeHandle(ref, () => ({
        resizeTerminal: resizeTerminal,
    }));

    useEffect(() => {
        if (!hostConfig || !terminalRef.current) return;

        terminalInstance.current = new Terminal({
            cursorBlink: true,
            theme: {
                background: theme.palette.background.terminal,
                foreground: theme.palette.text.primary,
                cursor: theme.palette.text.primary,
            },
            fontSize: 14,
            scrollback: 1000,
            ignoreBracketedPasteMode: true,
            fastScrollModifier: 'alt',
            fastScrollSensitivity: 5,
            letterSpacing: 0,
            lineHeight: 1,
            padding: 2,
        });

        terminalInstance.current.loadAddon(fitAddon.current);
        terminalInstance.current.open(terminalRef.current);

        const socket = io(
            window.location.hostname === "localhost"
                ? "http://localhost:8081"
                : "/",
            {
                path: "/ssh.io/socket.io",
                transports: ["websocket", "polling"],
            }
        );
        socketRef.current = socket;

        socket.on("connect_error", (error) => {
            terminalInstance.current.write(`\r\n*** Socket connection error: ${error.message} ***\r\n`);
        });

        socket.on("connect_timeout", () => {
            terminalInstance.current.write(`\r\n*** Socket connection timeout ***\r\n`);
        });

        socket.on("error", (err) => {
            const isAuthError = err.toLowerCase().includes("authentication") || err.toLowerCase().includes("auth");
            if (isAuthError && !hostConfig.password?.trim() && !hostConfig.sshKey?.trim() && !authModalShown) {
                authModalShown = true;
                setIsNoAuthHidden(false);
            }
            terminalInstance.current.write(`\r\n*** Error: ${err} ***\r\n`);
        });

        socket.on("connect", () => {
            fitAddon.current.fit();
            resizeTerminal();
            const { cols, rows } = terminalInstance.current;

            if (!hostConfig.password?.trim() && !hostConfig.sshKey?.trim()) {
                setIsNoAuthHidden(false);
                return;
            }

            const sshConfig = {
                ip: hostConfig.ip,
                user: hostConfig.user,
                port: Number(hostConfig.port) || 22,
                password: hostConfig.password?.trim(),
                sshKey: hostConfig.sshKey?.trim()
            };

            socket.emit("connectToHost", cols, rows, sshConfig);
        });

        setTimeout(() => {
            fitAddon.current.fit();
            resizeTerminal();
            terminalInstance.current.focus();
        }, 50);

        socket.on("data", (data) => {
            const decoder = new TextDecoder("utf-8");
            terminalInstance.current.write(decoder.decode(new Uint8Array(data)));
        });

        terminalInstance.current.onData((data) => {
            if (data.length === 1) {
                socketRef.current.emit("data", data);
                return;
            }

            if (socketRef.current) {
                socketRef.current.emit("data", data);
            }
        });

        const getClipboardText = async () => {
            try {
                // Modern Clipboard API - this will work in secure contexts (HTTPS or localhost)
                if (navigator.clipboard && navigator.clipboard.readText) {
                    try {
                        return await navigator.clipboard.readText();
                    } catch (clipboardErr) {
                        console.warn("Navigator clipboard API failed:", clipboardErr);
                        // Continue to fallback methods
                    }
                }

                // Fallback method using document.execCommand
                if (document.queryCommandSupported && document.queryCommandSupported('paste')) {
                    const textarea = document.createElement('textarea');
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    
                    try {
                        document.execCommand('paste');
                        const text = textarea.value;
                        document.body.removeChild(textarea);
                        if (text) return text;
                    } catch (execErr) {
                        document.body.removeChild(textarea);
                        console.warn("execCommand paste failed:", execErr);
                        // Continue to next fallback
                    }
                }

                // Fallback UI prompt for non-secure contexts where clipboard API is restricted
                if (!window.location.hostname.includes('localhost') && 
                    !window.location.protocol.includes('https')) {
                    
                    // Display input prompt in the terminal itself
                    terminalInstance.current.write("\r\n\r\nPaste access denied. Please type or paste content here:\r\n");
                    
                    // Use a terminal-based input method
                    return new Promise(resolve => {
                        let inputText = '';
                        const dataHandler = terminalInstance.current.onData(data => {
                            // Check for enter key (carriage return)
                            if (data === '\r') {
                                terminalInstance.current.write('\r\n');
                                dataHandler.dispose(); // Remove the handler
                                resolve(inputText);
                                return;
                            }
                            
                            // Handle backspace
                            if (data === '\x7f') {
                                if (inputText.length > 0) {
                                    inputText = inputText.slice(0, -1);
                                    terminalInstance.current.write('\b \b'); // Erase the character
                                }
                                return;
                            }
                            
                            // Normal character input
                            inputText += data;
                            terminalInstance.current.write(data);
                        });
                    });
                }
                
                throw new Error('No clipboard access methods available');
            } catch (err) {
                console.error("Failed to read clipboard contents:", err);
                return null;
            }
        };

        // Track if paste is in progress to prevent double paste
        let pasteInProgress = false;

        terminalInstance.current.attachCustomKeyEventHandler(async (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "v") {
                event.preventDefault();

                // Prevent double paste execution
                if (pasteInProgress || !socketRef.current) return false;
                
                pasteInProgress = true;
                
                try {
                    const text = await getClipboardText();
                    if (!text) {
                        terminalInstance.current.write("\r\nClipboard access denied or empty\r\n");
                        pasteInProgress = false;
                        return false;
                    }
                    
                    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        
                        if (i === 0) {
                            socketRef.current.emit("data", line);
                        } 
                        else if (i < lines.length - 1) {
                            socketRef.current.emit("data", "\r" + line);
                        } 
                        else if (i > 0) {
                            const endsWithNewline = text.endsWith("\n") || text.endsWith("\r\n") || text.endsWith("\r");
                            socketRef.current.emit("data", "\r" + line + (endsWithNewline ? "\r" : ""));
                        }
                        else if (lines.length === 1 && (text.endsWith("\n") || text.endsWith("\r\n") || text.endsWith("\r"))) {
                            socketRef.current.emit("data", line + "\r");
                        }
                    }
                } catch (err) {
                    console.error("Failed to process clipboard contents:", err);
                }
                
                // Set timeout to reset paste lock
                setTimeout(() => {
                    pasteInProgress = false;
                }, 100);

                return false;
            }

            return true;
        });

        const setClipboardText = (text) => {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text);
                    return true;
                }

                if (document.queryCommandSupported && document.queryCommandSupported('copy')) {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    
                    try {
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        return true;
                    } catch (e) {
                        document.body.removeChild(textarea);
                        return false;
                    }
                }
                
                return false;
            } catch (err) {
                console.error("Failed to write to clipboard:", err);
                return false;
            }
        };

        terminalInstance.current.onKey(({ domEvent }) => {
            if (domEvent.key === "c" && (domEvent.ctrlKey || domEvent.metaKey)) {
                const selection = terminalInstance.current.getSelection();
                if (selection) {
                    setClipboardText(selection);
                }
            }
        });

        let authModalShown = false;

        socket.on("noAuthRequired", () => {
            if (!hostConfig.password?.trim() && !hostConfig.sshKey?.trim() && !authModalShown) {
                authModalShown = true;
                setIsNoAuthHidden(false);
            }
        });

        const pingInterval = setInterval(() => {
            socketRef.current.emit("ping");
        }, 5000);

        socketRef.current.on("pong", () => {
            console.log("Received pong from server.");
        });

        return () => {
            clearInterval(pingInterval);
            if (terminalInstance.current) {
                terminalInstance.current.dispose();
                terminalInstance.current = null;
            }
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            authModalShown = false;
        };
    }, [hostConfig]);

    useEffect(() => {
        resizeTerminal();
    }, [isVisible]);

    useEffect(() => {
        const terminalContainer = terminalRef.current;
        if (!terminalContainer) return;

        const parentContainer = terminalContainer.parentElement;
        if (!parentContainer) return;

        const resizeObserver = new ResizeObserver(() => {
            resizeTerminal();
        });

        resizeObserver.observe(parentContainer);

        const handleWindowResize = () => {
            resizeTerminal();
        };
        
        window.addEventListener('resize', handleWindowResize);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    return (
        <div
            ref={terminalRef}
            className="w-full h-full overflow-hidden text-left"
            style={{
                visibility: isVisible ? 'visible' : 'hidden',
                position: 'absolute',
                width: '100%',
                height: '100%',
                transform: 'translateY(2px) translateX(3px)',
            }}
        />
    );
});

NewTerminal.displayName = "NewTerminal";

NewTerminal.propTypes = {
    hostConfig: PropTypes.shape({
        ip: PropTypes.string.isRequired,
        user: PropTypes.string.isRequired,
        password: PropTypes.string,
        sshKey: PropTypes.string,
        port: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    }).isRequired,
    isVisible: PropTypes.bool.isRequired,
    setIsNoAuthHidden: PropTypes.func.isRequired,
};