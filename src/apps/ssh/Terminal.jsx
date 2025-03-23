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

                // Check if clipboard API is available
                if (navigator.clipboard && navigator.clipboard.readText) {
                    navigator.clipboard.readText().then((text) => {
                        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                        
                        if (socketRef.current && socketRef.current.connected) {
                            const processedText = text.replace(/\n/g, "\r");
                            socketRef.current.emit("data", processedText);
                            
                            setTimeout(() => {
                                isPasting = false;
                            }, 50);
                        } else {
                            isPasting = false;
                        }
                    }).catch((err) => {
                        console.error("Failed to read clipboard contents:", err);
                        // Try to handle paste manually using execCommand for fallback
                        tryFallbackPaste();
                    });
                } else {
                    // Fallback for browsers where clipboard API is not yet available
                    tryFallbackPaste();
                }

                return false;
            }

            return true;
        });

        // Add fallback paste method using execCommand or input element
        const tryFallbackPaste = () => {
            try {
                // Create temporary textarea for paste operation
                const textarea = document.createElement('textarea');
                textarea.style.position = 'absolute';
                textarea.style.left = '-9999px';
                textarea.style.top = '0px';
                document.body.appendChild(textarea);
                textarea.focus();
                
                // Try execCommand paste (works in some browsers)
                const successful = document.execCommand('paste');
                if (successful) {
                    const text = textarea.value;
                    if (text && socketRef.current && socketRef.current.connected) {
                        const processedText = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
                        socketRef.current.emit("data", processedText);
                    }
                } else {
                    console.log("Fallback paste failed, clipboard permissions may be needed");
                    terminalInstance.current.write("\r\n*** Paste failed: Please try again or grant clipboard permissions ***\r\n");
                }
                
                // Clean up
                document.body.removeChild(textarea);
                setTimeout(() => {
                    isPasting = false;
                }, 50);
            } catch (err) {
                console.error("Fallback paste failed:", err);
                terminalInstance.current.write("\r\n*** Paste failed: Try clicking in the terminal first ***\r\n");
                isPasting = false;
            }
        };

        terminalInstance.current.onKey(({ domEvent }) => {
            if (domEvent.key === "c" && (domEvent.ctrlKey || domEvent.metaKey)) {
                const selection = terminalInstance.current.getSelection();
                if (selection) {
                    navigator.clipboard.writeText(selection);
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