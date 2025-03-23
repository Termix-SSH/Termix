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
            fitAddon.current.fit();
            if (socketRef.current && terminalInstance.current) {
                const { cols, rows } = terminalInstance.current;
                socketRef.current.emit("resize", { cols, rows });
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
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 20000,
            }
        );
        socketRef.current = socket;

        socket.on("connect_error", (error) => {
            terminalInstance.current.write(`\r\n*** Socket connection error: ${error.message} ***\r\n`);
            console.error("Socket connection error:", error);
        });

        socket.on("connect_timeout", () => {
            terminalInstance.current.write(`\r\n*** Socket connection timeout ***\r\n`);
            console.error("Socket connection timeout");
        });

        socket.on("error", (err) => {
            console.error("SSH connection error:", err);
            const isAuthError = err.toLowerCase().includes("authentication") || err.toLowerCase().includes("auth");
            if (isAuthError && !hostConfig.password?.trim() && !hostConfig.sshKey?.trim() && !authModalShown) {
                authModalShown = true;
                setIsNoAuthHidden(false);
            }
            terminalInstance.current.write(`\r\n*** Error: ${err} ***\r\n`);
        });

        socket.on("connect", () => {
            console.log("Socket connected, attempting SSH connection...");
            
            fitAddon.current.fit();
            resizeTerminal();
            const { cols, rows } = terminalInstance.current;

            // Check for authentication details
            if (!hostConfig.password?.trim() && !hostConfig.sshKey?.trim()) {
                console.log("No authentication provided, showing modal");
                setIsNoAuthHidden(false);
                return;
            }

            // Ensure we have proper SSH config with both key field names for backward compatibility
            const sshConfig = {
                ip: hostConfig.ip,
                user: hostConfig.user,
                port: Number(hostConfig.port) || 22,
                password: hostConfig.password?.trim(),
                sshKey: hostConfig.sshKey?.trim(),
                rsaKey: hostConfig.sshKey?.trim() || hostConfig.rsaKey?.trim(),
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

        let isPasting = false;

        terminalInstance.current.onData((data) => {
            if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit("data", data);
            }
        });

        terminalInstance.current.attachCustomKeyEventHandler((event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "v") {
                if (isPasting) return false;
                isPasting = true;

                event.preventDefault();

                // Use a multi-layered approach for clipboard access
                const pasteFromClipboard = async () => {
                    try {
                        // Try modern Clipboard API first
                        if (navigator.clipboard && navigator.clipboard.readText) {
                            try {
                                const text = await navigator.clipboard.readText();
                                if (text && socketRef.current?.connected) {
                                    const processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                                    socketRef.current.emit("data", processedText);
                                    return true;
                                }
                            } catch (clipboardErr) {
                                console.warn("Clipboard API failed:", clipboardErr);
                                // Continue to fallbacks
                            }
                        }

                        // Try execCommand fallback
                        if (document.queryCommandSupported && document.queryCommandSupported('paste')) {
                            const textarea = document.createElement('textarea');
                            textarea.style.position = 'fixed';
                            textarea.style.opacity = '0';
                            document.body.appendChild(textarea);
                            textarea.focus();
                            
                            try {
                                const successful = document.execCommand('paste');
                                if (successful) {
                                    const text = textarea.value;
                                    if (text && socketRef.current?.connected) {
                                        const processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                                        socketRef.current.emit("data", processedText);
                                        document.body.removeChild(textarea);
                                        return true;
                                    }
                                }
                            } catch (execErr) {
                                console.warn("execCommand paste failed:", execErr);
                            }
                            document.body.removeChild(textarea);
                        }

                        // Show permissions warning and instructions
                        terminalInstance.current.write("\r\n*** To paste: Right-click in terminal and select Paste from context menu ***\r\n");
                        return false;
                    } finally {
                        setTimeout(() => {
                            isPasting = false;
                        }, 100);
                    }
                };

                pasteFromClipboard();
                return false;
            }

            return true;
        });

        terminalInstance.current.onKey(({ domEvent }) => {
            if (domEvent.key === "c" && (domEvent.ctrlKey || domEvent.metaKey)) {
                const selection = terminalInstance.current.getSelection();
                if (selection) {
                    // Use a try-catch to handle clipboard failures
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(selection)
                                .catch(err => {
                                    console.warn("Clipboard write failed:", err);
                                    terminalInstance.current.write("\r\n*** Copy failed: Text copied to internal buffer ***\r\n");
                                    // Store selection in a variable as fallback
                                    window.termixInternalClipboard = selection;
                                });
                        } else {
                            // Fallback for browsers without clipboard API
                            const textarea = document.createElement('textarea');
                            textarea.value = selection;
                            textarea.style.position = 'fixed';
                            textarea.style.opacity = '0';
                            document.body.appendChild(textarea);
                            textarea.select();
                            
                            try {
                                const successful = document.execCommand('copy');
                                if (!successful) {
                                    terminalInstance.current.write("\r\n*** Copy failed: Text copied to internal buffer ***\r\n");
                                    window.termixInternalClipboard = selection;
                                }
                            } catch (err) {
                                console.warn("execCommand copy failed:", err);
                                terminalInstance.current.write("\r\n*** Copy failed: Text copied to internal buffer ***\r\n");
                                window.termixInternalClipboard = selection;
                            }
                            
                            document.body.removeChild(textarea);
                        }
                    } catch (err) {
                        console.error("Copy failed:", err);
                        terminalInstance.current.write("\r\n*** Copy failed: Text copied to internal buffer ***\r\n");
                        window.termixInternalClipboard = selection;
                    }
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

        socket.on("disconnect", (reason) => {
            console.log("Socket disconnected:", reason);
            terminalInstance.current.write(`\r\n*** Socket disconnected: ${reason} ***\r\n`);
        });

        socket.on("reconnect", (attemptNumber) => {
            console.log("Socket reconnected after", attemptNumber, "attempts");
            terminalInstance.current.write(`\r\n*** Socket reconnected after ${attemptNumber} attempts ***\r\n`);
        });

        socket.on("reconnect_error", (error) => {
            console.error("Socket reconnect error:", error);
            terminalInstance.current.write(`\r\n*** Socket reconnect error: ${error.message} ***\r\n`);
        });

        const pingInterval = setInterval(() => {
            if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit("ping");
            }
        }, 5000);

        socketRef.current.on("pong", () => {});

        // Add right-click context menu for paste
        const element = terminalInstance.current.element;
        if (element) {
            element.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                
                // Create and show context menu
                const contextMenu = document.createElement('div');
                contextMenu.className = 'terminal-context-menu';
                contextMenu.style.position = 'fixed';
                contextMenu.style.left = `${event.clientX}px`;
                contextMenu.style.top = `${event.clientY}px`;
                contextMenu.style.backgroundColor = '#1e1e1e';
                contextMenu.style.border = '1px solid #555';
                contextMenu.style.borderRadius = '4px';
                contextMenu.style.padding = '4px 0';
                contextMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
                contextMenu.style.zIndex = '1000';
                
                // Create copy option
                const copyOption = document.createElement('div');
                copyOption.innerText = 'Copy';
                copyOption.className = 'terminal-context-menu-item';
                copyOption.style.padding = '6px 12px';
                copyOption.style.cursor = 'pointer';
                copyOption.style.color = 'white';
                copyOption.style.fontSize = '14px';
                copyOption.onmouseover = () => {
                    copyOption.style.backgroundColor = '#3a3a3a';
                };
                copyOption.onmouseout = () => {
                    copyOption.style.backgroundColor = 'transparent';
                };
                
                // Handle copy action
                copyOption.onclick = () => {
                    const selection = terminalInstance.current.getSelection();
                    if (selection) {
                        // Try to copy using clipboard API
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(selection)
                                .catch(err => {
                                    console.warn("Clipboard write failed:", err);
                                    window.termixInternalClipboard = selection;
                                    terminalInstance.current.write("\r\n*** Copied to internal clipboard ***\r\n");
                                });
                        } else {
                            // Store in internal clipboard
                            window.termixInternalClipboard = selection;
                            terminalInstance.current.write("\r\n*** Copied to internal clipboard ***\r\n");
                        }
                    }
                    document.body.removeChild(contextMenu);
                };
                
                // Create paste option
                const pasteOption = document.createElement('div');
                pasteOption.innerText = 'Paste';
                pasteOption.className = 'terminal-context-menu-item';
                pasteOption.style.padding = '6px 12px';
                pasteOption.style.cursor = 'pointer';
                pasteOption.style.color = 'white';
                pasteOption.style.fontSize = '14px';
                pasteOption.onmouseover = () => {
                    pasteOption.style.backgroundColor = '#3a3a3a';
                };
                pasteOption.onmouseout = () => {
                    pasteOption.style.backgroundColor = 'transparent';
                };
                
                // Handle paste action
                pasteOption.onclick = async () => {
                    try {
                        // Try clipboard API first
                        if (navigator.clipboard && navigator.clipboard.readText) {
                            try {
                                const text = await navigator.clipboard.readText();
                                if (text && socketRef.current?.connected) {
                                    const processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                                    socketRef.current.emit("data", processedText);
                                }
                            } catch (err) {
                                // Use fallback or internal clipboard
                                if (window.termixInternalClipboard) {
                                    const processedText = window.termixInternalClipboard.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                                    socketRef.current.emit("data", processedText);
                                } else {
                                    terminalInstance.current.write("\r\n*** Paste failed: No clipboard content available ***\r\n");
                                }
                            }
                        } else if (window.termixInternalClipboard) {
                            // Use internal clipboard if available
                            const processedText = window.termixInternalClipboard.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                            socketRef.current.emit("data", processedText);
                        } else {
                            terminalInstance.current.write("\r\n*** Paste failed: No clipboard content available ***\r\n");
                        }
                    } finally {
                        document.body.removeChild(contextMenu);
                    }
                };
                
                // Add options to menu
                contextMenu.appendChild(copyOption);
                contextMenu.appendChild(pasteOption);
                document.body.appendChild(contextMenu);
                
                // Remove menu when clicking elsewhere
                const removeMenu = (e) => {
                    if (!contextMenu.contains(e.target)) {
                        document.body.removeChild(contextMenu);
                        document.removeEventListener('click', removeMenu);
                    }
                };
                
                setTimeout(() => {
                    document.addEventListener('click', removeMenu);
                }, 0);
            });
        }

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
        rsaKey: PropTypes.string,
        port: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    }).isRequired,
    isVisible: PropTypes.bool.isRequired,
    setIsNoAuthHidden: PropTypes.func.isRequired,
};