import type { MutableRefObject } from "react";
import type { TabHandle } from "@termix-ssh/plugin-sdk/frontend";
import type {
  ConfirmOptions,
  EditingWidth,
} from "@/components/surface/surface-scope";
import type { Host, HostFolder, Tab, TabType } from "@/types/ui-types";
import type { OpenTabRecord, UserPreferences } from "@/main-axios";
import type { TabShellCallbacks } from "@/shell/tab-registry";
import type { SplitViewActions } from "@/shell/split/SplitView";
import type {
  NewTabOption,
  PickHostTarget,
} from "@/shell/split/EmptyPanePicker";
import type {
  SplitSummary,
  SplitTab,
  TabSplitAction,
} from "@/shell/split/split-tabs";

export interface DockRegion {
  view: string;
  open: boolean;
  width: number;
  dragging: boolean;
  editing: EditingWidth;
  setView: (view: string | ((prev: string) => string)) => void;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setWidth: (width: number) => void;
  startResize: (e: React.MouseEvent) => void;
  resetWidth: () => void;
}

export interface RightDockRegion {
  view: string | null;
  open: boolean;
  width: number;
  dragging: boolean;
  setView: (
    view: string | null | ((prev: string | null) => string | null),
  ) => void;
  setWidth: (width: number) => void;
  startResize: (e: React.MouseEvent) => void;
  resetWidth: () => void;
}

export interface ShellRegions {
  left: DockRegion;
  right: RightDockRegion;
  /** What clicking a rail item does: toggles or switches the left dock. */
  railClick: (view: string) => void;
  openInRightDock: (view: string) => void;
  toggleRightDock: () => void;
  previousView: () => string | null;
  /** Stable setters a panel reports its wanted sidebar width with. */
  panelEditingSetter: (view: string) => (editing: EditingWidth) => void;
  scopeEditingSetter: (view: string) => (editing: EditingWidth) => void;
}

export interface OpenTabOptions {
  data?: Record<string, unknown>;
  label?: string;
  forceNewTab?: boolean;
}

export interface RestoreTarget {
  instanceId: string;
  restoredSessionId: string | null;
  savedLabel?: string;
}

export interface ShellTabs {
  list: Tab[];
  /** Tabs shown in a tab bar: everything not sitting inside a split. */
  topLevel: Tab[];
  activeId: string;
  active: Tab | undefined;
  ready: boolean;
  /** Tabs panels can type into. */
  terminalTabs: Tab[];
  /** The terminal command panels act on right now. */
  targetTerminal: Tab | undefined;
  showNumbers: boolean;
  background: OpenTabRecord[];
  setBackground: (
    next: OpenTabRecord[] | ((prev: OpenTabRecord[]) => OpenTabRecord[]),
  ) => void;
  setActive: (id: string) => void;
  setList: (next: Tab[] | ((prev: Tab[]) => Tab[])) => void;
  reorder: (topLevel: Tab[]) => void;
  open: (
    host: Host,
    type: TabType,
    restore?: RestoreTarget,
    options?: OpenTabOptions,
  ) => string;
  openSingleton: (
    type: TabType,
    pendingEvent?: string,
    host?: Host,
    data?: Record<string, unknown>,
    label?: string,
  ) => string | undefined;
  openMultiInstance: (
    type: TabType,
    options?: { host?: Host; data?: Record<string, unknown>; label?: string },
  ) => string;
  connectHost: (host: Host, type?: TabType, options?: OpenTabOptions) => void;
  close: (id: string) => Promise<void>;
  rename: (id: string, label: string) => void;
  refresh: (id: string) => void;
  reconnectAll: () => void;
  handleFor: (id: string) => TabHandle | null | undefined;
}

export interface EmptyPaneApi {
  freeTabs: Tab[];
  newTabOptions: NewTabOption[];
  pickTab: (splitTabId: string, paneId: string, tabId: string) => void;
  pickHost: (
    splitTabId: string,
    paneId: string,
    host: Host,
    pick: PickHostTarget,
  ) => void;
  openType: (splitTabId: string, paneId: string, type: string) => void;
  closePane: (splitTabId: string, paneId: string) => void;
}

export interface ShellSplit {
  active: SplitTab | null;
  /** The pane each on-screen tab sits in, for the active split only. */
  paneIdByTabId: Map<string, string>;
  focusedPaneId: string | null;
  summaries: SplitSummary[];
  activeFull: boolean;
  handleAction: (action: TabSplitAction) => void;
  viewActions: (splitTabId: string) => SplitViewActions;
  emptyPane: EmptyPaneApi;
}

export interface ShellHosts {
  list: Host[];
  tree: HostFolder | null;
  loading: boolean;
  loaded: boolean;
  reload: () => Promise<void>;
  edit: (host: Host) => void;
}

export interface ShellPalette {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

export interface ShellSettingsProps {
  username: string;
  isAdmin: boolean;
  onLogout: (options?: { manual?: boolean }) => void;
  userPrefs: UserPreferences;
  onPrefsChange: (updates: Partial<UserPreferences>) => void;
  onOpenHostTab: (host: Host) => void;
}

/** Everything the shell knows and can do, minus drawing it. */
export interface ShellController {
  username: string;
  isAdmin: boolean;
  isMobile: boolean;
  isElectron: boolean;
  pluginsSettled: boolean;
  logout: (options?: { manual?: boolean }) => void;
  tabs: ShellTabs;
  split: ShellSplit;
  hosts: ShellHosts;
  regions: ShellRegions;
  palette: ShellPalette;
  fullscreen: { active: boolean; toggle: () => void };
  /** One stable bag that forwards to the latest shell, for tabs and plugins. */
  callbacks: TabShellCallbacks;
  /** Same, but closes the sidebar on mobile after opening a tab. */
  panelCallbacks: TabShellCallbacks;
  settings: ShellSettingsProps;
  /** Where the main area's confirm is captured, see ShellConfirmCapture. */
  confirmRef: MutableRefObject<
    ((options: ConfirmOptions) => Promise<boolean>) | null
  >;
  /** Refits every visible terminal, e.g. after a pane resize ends. */
  resizeAllTerminals: () => number;
}
