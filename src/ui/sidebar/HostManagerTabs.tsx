/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  Box,
  Folder,
  KeyRound,
  Monitor,
  MousePointerClick,
  Network,
  Server,
  Settings,
  SquareTerminal,
  Terminal,
  Globe,
} from "lucide-react";

export type HostTabId =
  | "general"
  | "ssh"
  | "terminal"
  | "tunnels"
  | "docker"
  | "web-ui"
  | "proxmox"
  | "files"
  | "host-metrics"
  | "rdp"
  | "vnc"
  | "telnet";
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

export const SSH_GROUP_TABS = new Set<HostTabId>([
  "ssh",
  "terminal",
  "tunnels",
  "docker",
  "web-ui",
  "proxmox",
  "files",
  "host-metrics",
]);

/**
 * A plugin-contributed host editor tab. `component` receives the same
 * {form, setField} pair every built-in tab body gets (see HostDockerTab in
 * HostEditorFeatureTabs.tsx for the shape a plugin's own tab component
 * should match).
 */
export type HostEditorTabComponent = ComponentType<{
  form: unknown;
  setField: (key: string, value: unknown) => void;
}>;

interface RegisteredHostEditorTab {
  id: string;
  labelKey: string;
  icon: ReactNode;
  component: HostEditorTabComponent;
}

/**
 * Runtime registry for host editor tabs that don't exist in the built-in
 * HostTabId union. A plugin's frontend registers into this from its own
 * register() (see plugins/*\/frontend/index.mjs), the same pattern
 * rail-items.ts and tabUtils.tsx already use for their seams.
 */
const registeredHostEditorTabs = new Map<string, RegisteredHostEditorTab>();

export function registerHostEditorTab(def: RegisteredHostEditorTab): void {
  registeredHostEditorTabs.set(def.id, def);
}

export function unregisterHostEditorTab(id: string): void {
  registeredHostEditorTabs.delete(id);
}

export function getRegisteredHostEditorTab(
  id: string,
): RegisteredHostEditorTab | undefined {
  return registeredHostEditorTabs.get(id);
}

export function registeredHostEditorTabList(): RegisteredHostEditorTab[] {
  return [...registeredHostEditorTabs.values()];
}

export function makeHostTabs(t: (key: string) => string): HostTab[] {
  return [
    {
      id: "general",
      label: t("hosts.tabGeneral"),
      icon: <Settings className="size-3" />,
    },
    {
      id: "ssh",
      label: t("hosts.tabSsh"),
      icon: <Terminal className="size-3" />,
    },
    {
      id: "rdp",
      label: t("hosts.tabRdp"),
      icon: <Monitor className="size-3" />,
    },
    {
      id: "vnc",
      label: t("hosts.tabVnc"),
      icon: <MousePointerClick className="size-3" />,
    },
    {
      id: "telnet",
      label: t("hosts.tabTelnet"),
      icon: <Terminal className="size-3" />,
    },
  ];
}

export function makeHostSshSubTabs(t: (key: string) => string): HostTab[] {
  return [
    {
      id: "ssh",
      label: t("hosts.tabGeneral"),
      icon: <Settings className="size-3" />,
    },
    {
      id: "terminal",
      label: t("hosts.tabTerminal"),
      icon: <SquareTerminal className="size-3" />,
    },
    {
      id: "tunnels",
      label: t("hosts.tabTunnels"),
      icon: <Network className="size-3" />,
    },
    {
      id: "docker",
      label: t("hosts.tabDocker"),
      icon: <Box className="size-3" />,
    },
    {
      id: "web-ui",
      label: t("hosts.tabWebUi"),
      icon: <Globe className="size-3" />,
    },
    {
      id: "proxmox",
      label: t("hosts.tabProxmox"),
      icon: <Server className="size-3" />,
    },
    {
      id: "files",
      label: t("hosts.tabFiles"),
      icon: <Folder className="size-3" />,
    },
    {
      id: "host-metrics",
      label: t("hosts.tabHostMetrics"),
      icon: <Activity className="size-3" />,
    },
    ...registeredHostEditorTabList().map((tab) => ({
      id: tab.id as HostTabId,
      label: t(tab.labelKey),
      icon: tab.icon,
    })),
  ];
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
