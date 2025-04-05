import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import io from "socket.io-client";
import PropTypes from "prop-types";
import theme from "../../theme.js";

export const NewTerminal = forwardRef(({ hostConfig, isVisible, setIsNoAuthHidden, setErrorMessage, setIsErrorHidden }, ref) => {
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
        socketRef: socketRef,
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
        
        // Use the provided terminal ID or create a unique socket ID
        const terminalId = hostConfig.id || Date.now();
        
        // Set terminal-specific data on the socket for identification
        socket.terminalId = terminalId;
        socket.hostData = {
            ip: hostConfig.ip,
            user: hostConfig.user,
        };
        
        // Store socket reference in global map for snippet pasting
        if (!window.terminalSockets) {
            window.terminalSockets = {};
        }
        
        // Register this socket with the terminal ID
        window.terminalSockets[terminalId] = socket;
        console.log(`Terminal socket registered with ID: ${terminalId}`);
        console.log(`Socket connection properties: ${socket.connected ? 'connected' : 'disconnected'}`);
        
        // For debugging, show all available sockets
        console.log("Available terminal sockets:", Object.keys(window.terminalSockets).map(id => ({
            id,
            connected: window.terminalSockets[id].connected,
            ip: window.terminalSockets[id].hostData?.ip
        })));

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
                sshKey: hostConfig.sshKey?.trim(),
                rsaKey: hostConfig.sshKey?.trim() || hostConfig.rsaKey?.trim(),
            };

            socket.emit("connectToHost", cols, rows, sshConfig);
        });

        setTimeout(() => {
            if (terminalInstance.current) {
                fitAddon.current.fit();
                resizeTerminal();
                terminalInstance.current.focus();
            }
        }, 50);

        socket.on("data", (data) => {
            const decoder = new TextDecoder("utf-8");
            terminalInstance.current.write(decoder.decode(new Uint8Array(data)));
        });

        let isPasting = false;

        if (terminalInstance.current) {
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
                    navigator.clipboard.readText().then(text => {
                        if (text && socketRef.current?.connected) {
                            const processedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r");
                            socketRef.current.emit("data", processedText);
                        }
                    }).catch(() => {
                        setErrorMessage("Paste failed: Clipboard access denied. Instead, use Control Shift V.");
                        setIsErrorHidden(false);
                    }).finally(() => {
                        setTimeout(() => {
                            isPasting = false;
                        }, 300);
                    });
                    return false;
                }
                return true;
            });

            terminalInstance.current.onKey(({ domEvent }) => {
                if (domEvent.key === "c" && (domEvent.ctrlKey || domEvent.metaKey)) {
                    const selection = terminalInstance.current.getSelection();
                    if (selection) {
                        navigator.clipboard.writeText(selection);
                    }
                }
            });
        }

        let authModalShown = false;

        socket.on("noAuthRequired", () => {
            if (!hostConfig.password?.trim() && !hostConfig.sshKey?.trim() && !authModalShown) {
                authModalShown = true;
                setIsNoAuthHidden(false);
            }
        });

        socket.on("disconnect", (reason) => {
            if (terminalInstance.current) {
                terminalInstance.current.write(`\r\n*** Socket disconnected: ${reason} ***\r\n`);
            }
        });

        socket.on("reconnect", (attemptNumber) => {
            if (terminalInstance.current) {
                terminalInstance.current.write(`\r\n*** Socket reconnected after ${attemptNumber} attempts ***\r\n`);
            }
        });

        socket.on("reconnect_error", (error) => {
            console.error("Socket reconnect error:", error);
            if (terminalInstance.current) {
                terminalInstance.current.write(`\r\n*** Socket reconnect error: ${error.message} ***\r\n`);
            }
        });

        const pingInterval = setInterval(() => {
            if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit("ping");
            }
        }, 5000);

        socketRef.current.on("pong", () => {});

        return () => {
            clearInterval(pingInterval);
            
            // Remove from global registry when terminal is unmounted
            if (window.terminalSockets && window.terminalSockets[terminalId]) {
                console.log(`Unregistering terminal socket: ${terminalId}`);
                delete window.terminalSockets[terminalId];
            }
            
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
    setErrorMessage: PropTypes.func.isRequired,
    setIsErrorHidden: PropTypes.func.isRequired,
};