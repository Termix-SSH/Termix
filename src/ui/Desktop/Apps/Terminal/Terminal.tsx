import {useEffect, useRef, useState, useImperativeHandle, forwardRef} from 'react';
import {useXTerm} from 'react-xtermjs';
import {FitAddon} from '@xterm/addon-fit';
import {ClipboardAddon} from '@xterm/addon-clipboard';
import {Unicode11Addon} from '@xterm/addon-unicode11';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {useTranslation} from 'react-i18next';
import {toast} from 'sonner';

interface SSHTerminalProps {
    hostConfig: any;
    isVisible: boolean;
    title?: string;
    showTitle?: boolean;
    splitScreen?: boolean;
    onClose?: () => void;
}

export const Terminal = forwardRef<any, SSHTerminalProps>(function SSHTerminal(
    {hostConfig, isVisible, splitScreen = false, onClose},
    ref
) {
    const {t} = useTranslation();
    const {instance: terminal, ref: xtermRef} = useXTerm();
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const wasDisconnectedBySSH = useRef(false);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [visible, setVisible] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const isVisibleRef = useRef<boolean>(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 3;
    const isUnmountingRef = useRef(false);
    const shouldNotReconnectRef = useRef(false);
    const isReconnectingRef = useRef(false);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
    const DEBOUNCE_MS = 140;

    useEffect(() => {
        isVisibleRef.current = isVisible;
    }, [isVisible]);

    function hardRefresh() {
        try {
            if (terminal && typeof (terminal as any).refresh === 'function') {
                (terminal as any).refresh(0, terminal.rows - 1);
            }
        } catch (_) {
        }
    }

    function scheduleNotify(cols: number, rows: number) {
        if (!(cols > 0 && rows > 0)) return;
        pendingSizeRef.current = {cols, rows};
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        notifyTimerRef.current = setTimeout(() => {
            const next = pendingSizeRef.current;
            const last = lastSentSizeRef.current;
            if (!next) return;
            if (last && last.cols === next.cols && last.rows === next.rows) return;
            if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                webSocketRef.current.send(JSON.stringify({type: 'resize', data: next}));
                lastSentSizeRef.current = next;
            }
        }, DEBOUNCE_MS);
    }

    useImperativeHandle(ref, () => ({
        disconnect: () => {
            isUnmountingRef.current = true;
            shouldNotReconnectRef.current = true;
            isReconnectingRef.current = false;
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
            }
            webSocketRef.current?.close();
            setIsConnected(false);
            setIsConnecting(false); // Clear connecting state
        },
        fit: () => {
            fitAddonRef.current?.fit();
            if (terminal) scheduleNotify(terminal.cols, terminal.rows);
            hardRefresh();
        },
        sendInput: (data: string) => {
            if (webSocketRef.current?.readyState === 1) {
                webSocketRef.current.send(JSON.stringify({type: 'input', data}));
            }
        },
        notifyResize: () => {
            try {
                const cols = terminal?.cols ?? undefined;
                const rows = terminal?.rows ?? undefined;
                if (typeof cols === 'number' && typeof rows === 'number') {
                    scheduleNotify(cols, rows);
                    hardRefresh();
                }
            } catch (_) {
            }
        },
        refresh: () => hardRefresh(),
    }), [terminal]);

    useEffect(() => {
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, []);

    function handleWindowResize() {
        if (!isVisibleRef.current) return;
        fitAddonRef.current?.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();
    }

    function getCookie(name: string) {
        return document.cookie.split('; ').reduce((r, v) => {
            const parts = v.split('=');
            return parts[0] === name ? decodeURIComponent(parts[1]) : r;
        }, "");
    }

    function getUseRightClickCopyPaste() {
        return getCookie("rightClickCopyPaste") === "true"
    }

    function attemptReconnection() {
        // Don't attempt reconnection if component is unmounting, shouldn't reconnect, or already reconnecting
        if (isUnmountingRef.current || shouldNotReconnectRef.current || isReconnectingRef.current) {
            return;
        }

        // Check if we've already reached max attempts
        if (reconnectAttempts.current >= maxReconnectAttempts) {
            toast.error(t('terminal.maxReconnectAttemptsReached'));
            // Close the terminal tab when max attempts reached
            if (onClose) {
                onClose();
            }
            return;
        }

        // Set reconnecting flag to prevent multiple simultaneous attempts
        isReconnectingRef.current = true;
        
        // Clear terminal immediately to prevent showing last line
        if (terminal) {
            terminal.clear();
        }
        
        // Increment attempt counter
        reconnectAttempts.current++;
        
        // Show toast with current attempt number
        toast.info(t('terminal.reconnecting', { attempt: reconnectAttempts.current, max: maxReconnectAttempts }));
        
        reconnectTimeoutRef.current = setTimeout(() => {
            // Check again if component is still mounted and should reconnect
            if (isUnmountingRef.current || shouldNotReconnectRef.current) {
                isReconnectingRef.current = false;
                return;
            }
            
            // Check if we haven't exceeded max attempts during the timeout
            if (reconnectAttempts.current > maxReconnectAttempts) {
                isReconnectingRef.current = false;
                return;
            }
            
            if (terminal && hostConfig) {
                // Ensure terminal is clear before reconnecting
                terminal.clear();
                const cols = terminal.cols;
                const rows = terminal.rows;
                connectToHost(cols, rows);
            }
            
            // Reset reconnecting flag after attempting connection
            isReconnectingRef.current = false;
        }, 2000 * reconnectAttempts.current); // Exponential backoff
    }

    function connectToHost(cols: number, rows: number) {
        const isDev = process.env.NODE_ENV === 'development' &&
            (window.location.port === '3000' || window.location.port === '5173' || window.location.port === '');
        
        const isElectron = (window as any).IS_ELECTRON === true || (window as any).electronAPI?.isElectron === true;

        const wsUrl = isDev
            ? 'ws://localhost:8082'
            : isElectron
            ? (() => {
                // Get configured server URL from window object (set by main-axios)
                const baseUrl = (window as any).configuredServerUrl || 'http://127.0.0.1:8081';
                // Convert HTTP/HTTPS to WS/WSS and use nginx reverse proxy path
                const wsProtocol = baseUrl.startsWith('https://') ? 'wss://' : 'ws://';
                const wsHost = baseUrl.replace(/^https?:\/\//, ''); // Keep the port
                return `${wsProtocol}${wsHost}/ssh/websocket/`;
            })()
            : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ssh/websocket/`;

        const ws = new WebSocket(wsUrl);
        webSocketRef.current = ws;
        wasDisconnectedBySSH.current = false;
        setConnectionError(null);
        shouldNotReconnectRef.current = false; // Reset reconnection flag
        isReconnectingRef.current = false; // Reset reconnecting flag
        setIsConnecting(true); // Set connecting state

        setupWebSocketListeners(ws, cols, rows);
    }



    function setupWebSocketListeners(ws: WebSocket, cols: number, rows: number) {
        ws.addEventListener('open', () => {
            // Don't set isConnected to true here - wait for actual SSH connection
            // Don't show reconnected toast here - wait for actual connection confirmation
            
            // Set a timeout for SSH connection establishment
            connectionTimeoutRef.current = setTimeout(() => {
                if (!isConnected) {
                    // SSH connection didn't establish within timeout
                    // Clear terminal immediately when connection times out
                    if (terminal) {
                        terminal.clear();
                    }
                    toast.error(t('terminal.connectionTimeout'));
                    if (webSocketRef.current) {
                        webSocketRef.current.close();
                    }
                    // Attempt reconnection if this was a reconnection attempt
                    if (reconnectAttempts.current > 0) {
                        attemptReconnection();
                    }
                }
            }, 10000); // 10 second timeout for SSH connection
            
            ws.send(JSON.stringify({type: 'connectToHost', data: {cols, rows, hostConfig}}));
            terminal.onData((data) => {
                ws.send(JSON.stringify({type: 'input', data}));
            });
            
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({type: 'ping'}));
                }
            }, 30000);
        });

        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'data') {
                    terminal.write(msg.data);
                } else if (msg.type === 'error') {
                    // Handle different types of errors
                    const errorMessage = msg.message || t('terminal.unknownError');
                    
                    // Check if it's an authentication error
                    if (errorMessage.toLowerCase().includes('auth') || 
                        errorMessage.toLowerCase().includes('password') ||
                        errorMessage.toLowerCase().includes('permission') ||
                        errorMessage.toLowerCase().includes('denied') ||
                        errorMessage.toLowerCase().includes('invalid') ||
                        errorMessage.toLowerCase().includes('failed') ||
                        errorMessage.toLowerCase().includes('incorrect')) {
                        toast.error(t('terminal.authError', { message: errorMessage }));
                        shouldNotReconnectRef.current = true; // Don't reconnect on auth errors
                        // Close terminal on auth errors
                        if (webSocketRef.current) {
                            webSocketRef.current.close();
                        }
                        // Close the terminal tab immediately
                        if (onClose) {
                            onClose();
                        }
                        return;
                    }
                    
                    // Check if it's a connection error that should trigger reconnection
                    if (errorMessage.toLowerCase().includes('connection') ||
                        errorMessage.toLowerCase().includes('timeout') ||
                        errorMessage.toLowerCase().includes('network')) {
                        toast.error(t('terminal.connectionError', { message: errorMessage }));
                        setIsConnected(false);
                        // Clear terminal immediately when connection error occurs
                        if (terminal) {
                            terminal.clear();
                        }
                        // Set connecting state immediately for reconnection
                        setIsConnecting(true);
                        attemptReconnection();
                        return;
                    }
                    
                    // For other errors, show toast but don't close terminal
                    toast.error(t('terminal.error', { message: errorMessage }));
                } else if (msg.type === 'connected') {
                    setIsConnected(true);
                    setIsConnecting(false); // Clear connecting state
                    // Clear connection timeout since SSH connection is established
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }
                    // Show reconnected toast if this was a reconnection attempt
                    if (reconnectAttempts.current > 0) {
                        toast.success(t('terminal.reconnected'));
                    }
                    // Reset reconnection counter and flags on successful connection
                    reconnectAttempts.current = 0;
                    isReconnectingRef.current = false;
                } else if (msg.type === 'disconnected') {
                    wasDisconnectedBySSH.current = true;
                    setIsConnected(false);
                    // Clear terminal immediately when disconnected
                    if (terminal) {
                        terminal.clear();
                    }
                    // Set connecting state immediately for reconnection
                    setIsConnecting(true);
                    // Attempt reconnection for disconnections
                    if (!isUnmountingRef.current && !shouldNotReconnectRef.current) {
                        attemptReconnection();
                    }
                }
            } catch (error) {
                toast.error(t('terminal.messageParseError'));
            }
        });

        ws.addEventListener('close', (event) => {
            setIsConnected(false);
            // Clear terminal immediately when connection closes
            if (terminal) {
                terminal.clear();
            }
            // Set connecting state immediately for reconnection
            setIsConnecting(true);
            if (!wasDisconnectedBySSH.current && !isUnmountingRef.current && !shouldNotReconnectRef.current) {
                // Attempt reconnection for unexpected disconnections
                attemptReconnection();
            }
        });
        
        ws.addEventListener('error', (event) => {
            setIsConnected(false);
            setConnectionError(t('terminal.websocketError'));
            // Clear terminal immediately when WebSocket error occurs
            if (terminal) {
                terminal.clear();
            }
            // Set connecting state immediately for reconnection
            setIsConnecting(true);
            // Attempt reconnection for WebSocket errors
            if (!isUnmountingRef.current && !shouldNotReconnectRef.current) {
                attemptReconnection();
            }
        });
    }

    async function writeTextToClipboard(text: string): Promise<void> {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch (_) {
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    }

    async function readTextFromClipboard(): Promise<string> {
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                return await navigator.clipboard.readText();
            }
        } catch (_) {
        }
        return '';
    }

    useEffect(() => {
        if (!terminal || !xtermRef.current || !hostConfig) return;

        terminal.options = {
            cursorBlink: true,
            cursorStyle: 'bar',
            scrollback: 10000,
            fontSize: 14,
            fontFamily: '"JetBrains Mono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
            theme: {background: '#18181b', foreground: '#f7f7f7'},
            allowTransparency: true,
            convertEol: true,
            windowsMode: false,
            macOptionIsMeta: false,
            macOptionClickForcesSelection: false,
            rightClickSelectsWord: false,
            fastScrollModifier: 'alt',
            fastScrollSensitivity: 5,
            allowProposedApi: true,
        };

        const fitAddon = new FitAddon();
        const clipboardAddon = new ClipboardAddon();
        const unicode11Addon = new Unicode11Addon();
        const webLinksAddon = new WebLinksAddon();

        fitAddonRef.current = fitAddon;
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(clipboardAddon);
        terminal.loadAddon(unicode11Addon);
        terminal.loadAddon(webLinksAddon);
        terminal.open(xtermRef.current);

        const element = xtermRef.current;
        const handleContextMenu = async (e: MouseEvent) => {
            if (!getUseRightClickCopyPaste()) return;
            e.preventDefault();
            e.stopPropagation();
            try {
                if (terminal.hasSelection()) {
                    const selection = terminal.getSelection();
                    if (selection) {
                        await writeTextToClipboard(selection);
                        terminal.clearSelection();
                    }
                } else {
                    const pasteText = await readTextFromClipboard();
                    if (pasteText) terminal.paste(pasteText);
                }
            } catch (_) {
            }
        };
        element?.addEventListener('contextmenu', handleContextMenu);

        const resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
            resizeTimeout.current = setTimeout(() => {
                if (!isVisibleRef.current) return;
                fitAddonRef.current?.fit();
                if (terminal) scheduleNotify(terminal.cols, terminal.rows);
                hardRefresh();
            }, 100);
        });

        resizeObserver.observe(xtermRef.current);

        const readyFonts = (document as any).fonts?.ready instanceof Promise ? (document as any).fonts.ready : Promise.resolve();
        readyFonts.then(() => {
            setTimeout(() => {
                fitAddon.fit();
                setTimeout(() => {
                    fitAddon.fit();
                    if (terminal) scheduleNotify(terminal.cols, terminal.rows);
                    hardRefresh();
                    setVisible(true);
                    if (terminal && !splitScreen) {
                        terminal.focus();
                    }
                }, 0);

                const cols = terminal.cols;
                const rows = terminal.rows;

                const isDev = process.env.NODE_ENV === 'development' &&
                    (window.location.port === '3000' || window.location.port === '5173' || window.location.port === '');
                
                const isElectron = (window as any).IS_ELECTRON === true || (window as any).electronAPI?.isElectron === true;

                const wsUrl = isDev
                    ? 'ws://localhost:8082'
                    : isElectron
                    ? (() => {
                        // Get configured server URL from window object (set by main-axios)
                        const baseUrl = (window as any).configuredServerUrl || 'http://127.0.0.1:8081';
                        // Convert HTTP/HTTPS to WS/WSS and use nginx reverse proxy path
                        const wsProtocol = baseUrl.startsWith('https://') ? 'wss://' : 'ws://';
                        const wsHost = baseUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, ''); // Remove port if present
                        return `${wsProtocol}${wsHost}/ssh/websocket/`;
                    })()
                    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ssh/websocket/`;

                connectToHost(cols, rows);
            }, 300);
        });

        return () => {
            isUnmountingRef.current = true;
            shouldNotReconnectRef.current = true;
            isReconnectingRef.current = false;
            setIsConnecting(false); // Clear connecting state
            resizeObserver.disconnect();
            element?.removeEventListener('contextmenu', handleContextMenu);
            if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
            if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            webSocketRef.current?.close();
        };
    }, [xtermRef, terminal, hostConfig]);

    useEffect(() => {
        if (isVisible && fitAddonRef.current) {
            setTimeout(() => {
                fitAddonRef.current?.fit();
                if (terminal) scheduleNotify(terminal.cols, terminal.rows);
                hardRefresh();
                if (terminal && !splitScreen) {
                    terminal.focus();
                }
            }, 0);
            
            if (terminal && !splitScreen) {
                setTimeout(() => {
                    terminal.focus();
                }, 100);
            }
        }
    }, [isVisible, splitScreen, terminal]);

    useEffect(() => {
        if (!fitAddonRef.current) return;
        setTimeout(() => {
            fitAddonRef.current?.fit();
            if (terminal) scheduleNotify(terminal.cols, terminal.rows);
            hardRefresh();
            if (terminal && !splitScreen && isVisible) {
                terminal.focus();
            }
        }, 0);
    }, [splitScreen, isVisible, terminal]);

    return (
        <div className="h-full w-full m-1 relative">
            {/* Terminal */}
            <div 
                ref={xtermRef} 
                className={`h-full w-full transition-opacity duration-200 ${visible && isVisible && !isConnecting ? 'opacity-100' : 'opacity-0'} overflow-hidden`}
                onClick={() => {
                    if (terminal && !splitScreen) {
                        terminal.focus();
                    }
                }}
            />
            
            {/* Connecting State */}
            {isConnecting && (
                <div className="absolute inset-0 flex items-center justify-center bg-dark-bg">
                    <div className="flex items-center gap-3">
                        <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-gray-300">{t('terminal.connecting')}</span>
                    </div>
                </div>
            )}
        </div>
    );
});

const style = document.createElement('style');
style.innerHTML = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap');

/* Load NerdFonts locally */
@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Bold.ttf') format('truetype');
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Italic.ttf') format('truetype');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

.xterm .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  background: transparent;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(180,180,180,0.7);
  border-radius: 4px;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(120,120,120,0.9);
}
.xterm .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(180,180,180,0.7) transparent;
}

.xterm {
  font-feature-settings: "liga" 1, "calt" 1;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xterm .xterm-screen {
  font-family: 'JetBrains Mono Nerd Font', 'MesloLGS NF', 'FiraCode Nerd Font', 'Cascadia Code', 'JetBrains Mono', Consolas, "Courier New", monospace !important;
  font-variant-ligatures: contextual;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 1, "calt" 1;
}

.xterm .xterm-screen .xterm-char[data-char-code^="\\uE"] {
  font-family: 'JetBrains Mono Nerd Font', 'MesloLGS NF', 'FiraCode Nerd Font' !important;
}
`;
document.head.appendChild(style);
