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

        const parentWidth = parentContainer.clientWidth - 10;
        const parentHeight = parentContainer.clientHeight - 10;

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
        });

        terminalInstance.current.loadAddon(fitAddon.current);
        terminalInstance.current.open(terminalRef.current);

        setTimeout(() => {
            fitAddon.current.fit();
            resizeTerminal();
            terminalInstance.current.focus();
        }, 50);

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

        socket.on("connect", () => {
            fitAddon.current.fit();
            resizeTerminal();
            const { cols, rows } = terminalInstance.current;
            if (!hostConfig.password && !hostConfig.rsaKey) {
                setIsNoAuthHidden(false);
            } else {
                socket.emit("connectToHost", cols, rows, hostConfig);
            }
        });

        socket.on("data", (data) => {
            const decoder = new TextDecoder("utf-8");
            terminalInstance.current.write(decoder.decode(new Uint8Array(data)));
        });

        let isPasting = false;

        terminalInstance.current.onData((data) => {
            socketRef.current.emit("data", data);
        });

        terminalInstance.current.attachCustomKeyEventHandler((event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "v") {
                if (isPasting) return false;
                isPasting = true;

                event.preventDefault();

                navigator.clipboard.readText().then((text) => {
                    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                    const lines = text.split("\n");

                    if (socketRef.current) {
                        let index = 0;

                        const sendLine = () => {
                            if (index < lines.length) {
                                socketRef.current.emit("data", lines[index] + "\r");
                                index++;
                                setTimeout(sendLine, 10);
                            } else {
                                isPasting = false;
                            }
                        };

                        sendLine();
                    } else {
                        isPasting = false;
                    }
                }).catch((err) => {
                    console.error("Failed to read clipboard contents:", err);
                    isPasting = false;
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

        socket.on("noAuthRequired", () => {
            setIsNoAuthHidden(false);
        });

        socket.on("error", (err) => {
            terminalInstance.current.write(`\r\n*** Error: ${err} ***\r\n`);
        });

        return () => {
            terminalInstance.current.dispose();
            socket.disconnect();
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

        const observer = new ResizeObserver(() => {
            resizeTerminal();
        });

        observer.observe(parentContainer);

        return () => {
            observer.disconnect();
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
                transform: 'translateY(5px) translateX(5px)',
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
        rsaKey: PropTypes.string,
        port: PropTypes.number.isRequired,
    }).isRequired,
    isVisible: PropTypes.bool.isRequired,
    setIsNoAuthHidden: PropTypes.func.isRequired,
};