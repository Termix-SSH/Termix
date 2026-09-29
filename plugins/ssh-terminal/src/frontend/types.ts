import type { HostSshOptions } from "@termix/plugin-sdk/frontend";

/**
 * Host shapes as the terminal reads them. The plugin keeps its
 * own copy instead of importing core's types; only the fields it uses matter,
 * and the index signatures let the rest of a host record through.
 */

export type { BackspaceMode as HostBackspaceMode } from "../shared/terminal-settings";

/** A host as the shell hands it to a tab. */
export interface Host {
  id: number | string;
  name?: string;
  ip: string;
  port: number;
  username: string;
  sshOptions?: HostSshOptions | null;
  pluginSettings?: Record<string, Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Enough of a snippet for the variables dialog. */
export interface Snippet {
  id: number;
  name: string;
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type TabType = string;
