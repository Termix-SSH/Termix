/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { KeyRound, Settings, SquareTerminal, Terminal } from "lucide-react";
import { byOrderThenId, createRegistry } from "@/lib/registry";

/** Core host editor tabs. Plugins add theirs through registerHostEditorSection. */
export type CoreHostTabId = "general" | "ssh" | "terminal-options";
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
  snippets?: unknown[];
  protocols: Record<string, boolean>;
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
  icon?: ComponentType<{ className?: string }>;
  /** Position among the group's tabs, core ones included. */
  order?: number;
  /** Whether to offer the tab for these protocols. Defaults to always. */
  visible?: (protocols: Record<string, boolean>) => boolean;
  component: ComponentType<HostEditorSectionRenderProps>;
}

const sections = createRegistry<HostEditorSectionDef>(byOrderThenId);

export const registerHostEditorSection = sections.register;
export const unregisterHostEditorSection = sections.unregister;
export const getHostEditorSection = sections.get;
export const hostEditorSectionList = sections.list;
export const useHostEditorSections = sections.useList;
export const resetHostEditorSections = sections.reset;

const CORE_SSH_GROUP = new Set<string>(["ssh", "terminal-options"]);

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
): HostTab[] {
  const registered = sections
    .list()
    .filter(
      (section) =>
        section.group === group &&
        (!protocols || sectionVisible(section, protocols)),
    )
    .map((section) => {
      const Icon = section.icon;
      return {
        id: section.id,
        label: t(section.labelKey),
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
  );
}

export function makeHostSshSubTabs(
  t: (key: string) => string,
  protocols?: Record<string, boolean>,
): HostTab[] {
  return mergeByOrder(
    [
      {
        id: "ssh",
        label: t("hosts.tabGeneral"),
        icon: <Settings className="size-3" />,
        order: 0,
      },
      {
        id: "terminal-options",
        label: t("hosts.tabTerminal"),
        icon: <SquareTerminal className="size-3" />,
        order: 10,
      },
    ],
    "ssh",
    t,
    protocols,
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

export function TabStrip({
  tabs,
  activeTab,
  onTabChange,
  isActive,
  variant = "primary",
}: {
  tabs: { id: string; label: string; icon: ReactNode }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  isActive?: (id: string) => boolean;
  variant?: "primary" | "secondary";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const renderTab = (tab: (typeof tabs)[0]) => {
    const active = isActive ? isActive(tab.id) : activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => onTabChange(tab.id)}
        className={`flex items-center gap-1.5 px-3 ${
          variant === "secondary" ? "py-1.5 text-[11px]" : "py-2 text-xs"
        } font-medium whitespace-nowrap border-b-2 transition-colors shrink-0 ${
          active
            ? "border-accent-brand text-accent-brand"
            : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
      >
        {tab.icon}
        {tab.label}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className={`overflow-x-auto scrollbar-none ${
        variant === "secondary" ? "border-t border-border bg-card" : ""
      }`}
    >
      <div className="flex min-w-max">{tabs.map(renderTab)}</div>
    </div>
  );
}
