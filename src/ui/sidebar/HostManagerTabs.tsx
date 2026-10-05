/* eslint-disable react-refresh/only-export-components */
import { type ComponentType, type ReactNode } from "react";
import { KeyRound, Settings, Terminal } from "lucide-react";
import { byOrderThenId, createRegistry } from "@/lib/registry";

/** Core host editor tabs. Plugins add theirs through registerHostEditorSection. */
export type CoreHostTabId = "general" | "ssh";
export type HostTabId = CoreHostTabId | (string & {});
export type CredentialTabId = "general" | "auth";

type HostTab = {
  id: HostTabId;
  label: string;
  icon: ReactNode;
};
type CredentialTab = {
  id: CredentialTabId;
  label: string;
  icon: ReactNode;
};

export interface HostEditorSectionRenderProps {
  // The editor form is a plain object. Sections read the fields they own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  setField: (key: string, value: unknown) => void;
  /** Applies several fields at once, against the latest form. */
  updateForm: (
    patch: (form: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  host?: unknown;
  credentials?: unknown[];
  adminTargetUserId?: string;
  protocols: Record<string, boolean>;
  /** "defaults" in the host defaults editor. */
  mode?: "host" | "defaults";
}

/**
 * A host editor tab contributed at runtime. "top" tabs sit in the main strip
 * beside General and SSH; "ssh" tabs sit in the SSH group's second strip.
 */
export interface HostEditorSectionDef {
  id: string;
  pluginId?: string;
  group: "top" | "ssh";
  labelKey: string;
  /** Already-translated label, used instead of labelKey when set. */
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Position among the group's tabs, core ones included. */
  order?: number;
  /** Whether to offer the tab for these protocols. Defaults to always. */
  visible?: (protocols: Record<string, boolean>) => boolean;
  /** Also offered in the host defaults editor; "only" for nowhere else. */
  defaults?: boolean | "only";
  component: ComponentType<HostEditorSectionRenderProps>;
}

const sections = createRegistry<HostEditorSectionDef>(byOrderThenId);

export const registerHostEditorSection = sections.register;
export const unregisterHostEditorSection = sections.unregister;
export const getHostEditorSection = sections.get;
export const hostEditorSectionList = sections.list;
export const useHostEditorSections = sections.useList;
export const resetHostEditorSections = sections.reset;

const CORE_SSH_GROUP = new Set<string>(["ssh"]);

/** Whether a tab lives in the SSH group's second strip. */
export function isSshGroupTab(id: string): boolean {
  return CORE_SSH_GROUP.has(id) || sections.get(id)?.group === "ssh";
}

function sectionVisible(
  section: HostEditorSectionDef,
  protocols: Record<string, boolean>,
): boolean {
  if (!section.visible) return true;
  try {
    return section.visible(protocols);
  } catch {
    return false;
  }
}

function mergeByOrder(
  core: (HostTab & { order: number })[],
  group: "top" | "ssh",
  t: (key: string) => string,
  protocols: Record<string, boolean> | undefined,
  defaultsMode = false,
): HostTab[] {
  const registered = sections
    .list()
    .filter(
      (section) =>
        section.group === group &&
        (defaultsMode ? !!section.defaults : section.defaults !== "only") &&
        (defaultsMode || !protocols || sectionVisible(section, protocols)),
    )
    .map((section) => {
      const Icon = section.icon;
      return {
        id: section.id,
        label: section.label ?? t(section.labelKey),
        icon: Icon ? <Icon className="size-3" /> : null,
        order: section.order ?? 1000,
      };
    });
  return [...core, ...registered]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...tab }) => tab);
}

/**
 * The main strip. With `protocols`, registered tabs are filtered by their
 * `visible`; without, every registered top tab is listed.
 */
export function makeHostTabs(
  t: (key: string) => string,
  protocols?: Record<string, boolean>,
  defaultsMode = false,
): HostTab[] {
  return mergeByOrder(
    [
      {
        id: "general",
        label: t("hosts.tabGeneral"),
        icon: <Settings className="size-3" />,
        order: 0,
      },
      {
        id: "ssh",
        label: t("hosts.tabSsh"),
        icon: <Terminal className="size-3" />,
        order: 10,
      },
    ],
    "top",
    t,
    protocols,
    defaultsMode,
  );
}

export function makeHostSshSubTabs(
  t: (key: string) => string,
  protocols?: Record<string, boolean>,
  defaultsMode = false,
): HostTab[] {
  return mergeByOrder(
    [
      {
        id: "ssh",
        label: t("hosts.tabGeneral"),
        icon: <Settings className="size-3" />,
        order: 0,
      },
    ],
    "ssh",
    t,
    protocols,
    defaultsMode,
  );
}

export function makeCredentialTabs(
  t: (key: string) => string,
): CredentialTab[] {
  return [
    {
      id: "general",
      label: t("hosts.tabGeneral"),
      icon: <Settings className="size-3" />,
    },
    {
      id: "auth",
      label: t("hosts.tabAuthentication"),
      icon: <KeyRound className="size-3" />,
    },
  ];
}

export { TabStrip } from "@/components/tab-strip";
