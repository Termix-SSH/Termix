import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import io from "socket.io-client";
import PropTypes from "prop-types";
import theme from "./theme";

export const NewTerminal = forwardRef(({ hostConfig, isVisible }, ref) => {
    const terminalRef = useRef(null);
    const socketRef = useRef(null);
    const fitAddon = useRef(new FitAddon());
    const terminalInstance = useRef(null);

    const resizeTerminal = () => {
        const terminalContainer = terminalRef.current;
        const parentContainer = terminalContainer?.parentElement;

        if (!parentContainer || !isVisible) return;

        void parentContainer.offsetHeight;

        const parentWidth = parentContainer.clientWidth;
        const parentHeight = parentContainer.clientHeight;

        terminalContainer.style.width = `${parentWidth}px`;
        terminalContainer.style.height = `${parentHeight}px`;

        fitAddon.current.fit();

        if (socketRef.current && terminalInstance.current) {
            const { cols, rows } = terminalInstance.current;
            socketRef.current.emit("resize", { cols, rows });
        }
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
            fontFamily: 'monospace',
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
                path: "/socket.io",
                transports: ["websocket", "polling"],
            }
        );
        socketRef.current = socket;

        socket.on("connect", () => {
            fitAddon.current.fit();
            resizeTerminal();
            const { cols, rows } = terminalInstance.current;
            socket.emit("connectToHost", cols, rows, hostConfig);
        });

        socket.on("data", (data) => {
            const decoder = new TextDecoder("utf-8");
            terminalInstance.current.write(decoder.decode(new Uint8Array(data)));
        });

        terminalInstance.current.onData((data) => {
            socketRef.current.emit("data", data);
        });

        terminalInstance.current.attachCustomKeyEventHandler((event) => {
            if (
                (event.ctrlKey && event.key === "v") ||
                (event.metaKey && event.key === "v") ||
                (event.shiftKey && event.key === "Insert")
            ) {
                navigator.clipboard
                    .readText()
                    .then((text) => {
                        socketRef.current.emit("data", text);
                    })
                    .catch((err) => {
                        console.error("Failed to read clipboard contents:", err);
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

        socket.on("error", (err) => {
            terminalInstance.current.write(`\r\n*** Error: ${err} ***\r\n`);
        });

        return () => {
            terminalInstance.current.dispose();
            socket.disconnect();
        };
    }, [hostConfig]);

    useEffect(() => {
        if (isVisible) {
            resizeTerminal();
        }
    }, [isVisible]);

    useEffect(() => {
        const terminalContainer = terminalRef.current;
        if (!terminalContainer) return;

        const observer = new ResizeObserver(() => {
            resizeTerminal();
        });

        observer.observe(terminalContainer);

        return () => {
            observer.disconnect();
        };
    }, []);

    return (
        <div
            ref={terminalRef}
            className="w-full h-full overflow-hidden text-left"
            style={{ display: isVisible ? "block" : "none" }}
        />
    );
});

NewTerminal.displayName = "NewTerminal";

NewTerminal.propTypes = {
    hostConfig: PropTypes.shape({
        ip: PropTypes.string.isRequired,
        user: PropTypes.string.isRequired,
        password: PropTypes.string.isRequired,
        port: PropTypes.string.isRequired,
    }).isRequired,
    isVisible: PropTypes.bool.isRequired,
};