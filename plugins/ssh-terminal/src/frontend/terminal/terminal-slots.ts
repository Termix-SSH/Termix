import type { Host } from "../types";

/**
 * The slots the terminal offers plugins, and what it hands them.
 *
 * - "terminal.toolbar" (buttons): actions are invoked with a TerminalSlotApi.
 * - "terminal.toolbarStatus" (components): small live readouts at the end
 *   of the toolbar (host metrics), rendered with TerminalToolbarStatusProps.
 * - "terminal.sidePanel" (components): a side panel an action opens with
 *   `openSidePanel(id)`, rendered with TerminalSidePanelProps.
 * - "terminal.overlay" (components): always mounted over the terminal and
 *   given the session's server messages, for connection flows a plugin owns
 *   (a Tailscale check, an OPKSSH sign-in). It can answer on the socket.
 *
 * Every contribution's `when` sees `{ host }`.
 */
export const TERMINAL_TOOLBAR_SLOT = "terminal.toolbar";
export const TERMINAL_TOOLBAR_STATUS_SLOT = "terminal.toolbarStatus";
export const TERMINAL_SIDE_PANEL_SLOT = "terminal.sidePanel";
export const TERMINAL_OVERLAY_SLOT = "terminal.overlay";

export interface TerminalSlotApi {
  host: Host | undefined;
  /** The visible scrollback, read at call time. */
  getBufferText: () => string;
  /** The live session's id, once the server created it. */
  sessionId: () => string | null;
  /** Opens a "terminal.sidePanel" contribution by its actionId. */
  openSidePanel: (panelId: string, props?: Record<string, unknown>) => void;
  /** Types a command into the session and runs it. */
  runCommand: (command: string) => void;
  /**
   * What sharing this session needs, or null while there is nothing to share
   * (not connected yet, a quick connect, or a session joined from a share).
   */
  getShareTarget: () => {
    hostId: number;
    sessionId: string;
    protocol: "ssh";
    tabInstanceId?: string;
  } | null;
}

export interface TerminalToolbarStatusProps {
  host: Host;
  isConnected: boolean;
  /** Visible on a desktop viewport and connected: poll only while true. */
  active: boolean;
}

export interface TerminalSidePanelProps {
  host: Host | undefined;
  hostId: number | undefined;
  hostLabel: string;
  /** Whatever the opening action passed to openSidePanel. */
  panelProps: Record<string, unknown>;
  onClose: () => void;
  onRunInTerminal: (command: string) => void;
}

export interface TerminalSessionMessage {
  type: string;
  [key: string]: unknown;
}

export interface TerminalOverlayProps {
  host: Host | undefined;
  backgroundColor?: string;
  /** Server messages for this session, plus a local "session_closed". */
  subscribe: (
    listener: (message: TerminalSessionMessage) => void,
  ) => () => void;
  /**
   * Holds the connect timeout while the overlay waits on the user, e.g. an
   * approval in another window. Release it when done.
   */
  holdConnectTimeout: (held: boolean) => void;
  /** Ends the attempt with an error shown in the terminal. */
  fail: (message: string) => void;
  /** Closes the session's connection. */
  disconnect: () => void;
  /** Sends a message on the session's socket, as { type, data }. */
  send: (type: string, data?: unknown) => void;
  /**
   * What the server needs to connect again after a sign-in finished: send it
   * as the data of "<interaction>_auth_completed".
   */
  connectPayload: () => Record<string, unknown>;
}
