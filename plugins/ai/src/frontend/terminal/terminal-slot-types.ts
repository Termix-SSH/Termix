/**
 * What the ssh-terminal plugin hands its slots, as that plugin documents it.
 * Kept as a local copy: a plugin never imports another plugin's source.
 */

interface TerminalHost {
  id: number | string;
  name?: string;
  ip?: string;
  pluginSettings?: Record<string, Record<string, unknown> | undefined>;
  [key: string]: unknown;
}

/** What a "terminal.toolbar" action is invoked with. */
export interface TerminalSlotApi {
  host: TerminalHost | undefined;
  getBufferText: () => string;
  sessionId: () => string | null;
  openSidePanel: (panelId: string, props?: Record<string, unknown>) => void;
  runCommand: (command: string) => void;
}

/** What a "terminal.sidePanel" component is rendered with. */
export interface TerminalSidePanelProps {
  host: TerminalHost | undefined;
  hostId: number | undefined;
  hostLabel: string;
  panelProps: Record<string, unknown>;
  onClose: () => void;
  onRunInTerminal: (command: string) => void;
}
