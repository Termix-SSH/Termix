/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, type ReactNode } from "react";
import {
  Activity,
  Box,
  Folder,
  KeyRound,
  Monitor,
  MousePointerClick,
  Network,
  Settings,
  Terminal,
} from "lucide-react";

export type HostTabId =
  | "general"
  | "ssh"
  | "tunnels"
  | "docker"
  | "files"
  | "stats"
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
      id: "files",
      label: t("hosts.tabFiles"),
      icon: <Folder className="size-3" />,
    },
    {
      id: "stats",
      label: t("hosts.tabStats"),
      icon: <Activity className="size-3" />,
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

const SSH_DEP_TABS = new Set(["tunnels", "docker", "files", "stats"]);

export function TabStrip({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string; icon: ReactNode }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const hasSshGroup = tabs.some((t) => SSH_DEP_TABS.has(t.id));

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

  const nonSshTabs = tabs.filter((t) => !SSH_DEP_TABS.has(t.id));
  const sshDepTabs = tabs.filter((t) => SSH_DEP_TABS.has(t.id));

  const renderTab = (tab: (typeof tabs)[0]) => (
    <button
      key={tab.id}
      onClick={() => onTabChange(tab.id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0 ${
        activeTab === tab.id
          ? "border-accent-brand text-accent-brand"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {tab.icon}
      {tab.label}
    </button>
  );

  return (
    <div ref={ref} className="overflow-x-auto">
      <div className="flex min-w-max">
        {nonSshTabs.map(renderTab)}
        {hasSshGroup && sshDepTabs.length > 0 && (
          <div className="flex flex-col border-l border-border/40 ml-0.5">
            <div className="flex items-center gap-1 px-2 pt-0.5">
              <Terminal className="size-2.5 text-muted-foreground/30" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30">
                SSH
              </span>
            </div>
            <div className="flex">{sshDepTabs.map(renderTab)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
