import type { Host } from "@/types/ui-types";

/**
 * The slots the terminal offers plugins, and what it hands them.
 *
 * - "terminal.toolbar" (buttons): actions are invoked with a TerminalSlotApi.
 * - "terminal.dock" (components): a side panel an action opens with
 *   `openDock(id)`, rendered with TerminalDockProps.
 * - "terminal.overlay" (components): always mounted over the terminal and
 *   given the session's server messages, for connection flows a plugin owns
 *   (a Tailscale check, say).
 *
 * Every contribution's `when` sees `{ host }`.
 */
export const TERMINAL_TOOLBAR_SLOT = "terminal.toolbar";
export const TERMINAL_DOCK_SLOT = "terminal.dock";
export const TERMINAL_OVERLAY_SLOT = "terminal.overlay";

export interface TerminalSlotApi {
  host: Host | undefined;
  /** The visible scrollback, read at call time. */
  getBufferText: () => string;
  /** Opens a "terminal.dock" contribution by its actionId. */
  openDock: (dockId: string, props?: Record<string, unknown>) => void;
  /** Types a command into the session and runs it. */
  runCommand: (command: string) => void;
}

export interface TerminalDockProps {
  host: Host | undefined;
  hostId: number | undefined;
  hostLabel: string;
  /** Whatever the opening action passed to openDock. */
  dockProps: Record<string, unknown>;
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
}
