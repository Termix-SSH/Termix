import { useEffect, useState, type ComponentType } from "react";
import { Boxes, HardDrive, Server } from "lucide-react";
import {
  useHosts,
  useTranslation,
  type HostEditorSectionProps,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { ComponentSlot, DropdownMenuItem } from "@termix/plugin-sdk/ui";
import type { SSHHostWithStatus } from "@/main-axios";
import { ProxmoxDiscoverDialog } from "./ProxmoxDiscoverDialog";
import { HostProxmoxTab } from "./HostProxmoxTab";
import { ProxmoxStatsTab } from "./stats/ProxmoxStatsTab";
import ProxmoxStatsApp from "./stats/ProxmoxStatsApp";
import { HostProxmoxStatsTab } from "./stats/HostProxmoxStatsTab";
import type { SSHHost } from "@/types";

interface DiscoverRequest {
  hostId?: number;
  defaultCredentialId?: number | null;
  defaultAuthType?: string;
}

type Opener = (request: DiscoverRequest) => void;

// The Proxmox fields are this plugin's host settings, saved with the host
// through form.pluginSettings.proxmox.
function ProxmoxHostSection({ form, updateForm }: HostEditorSectionProps) {
  const values = (form.pluginSettings?.proxmox ?? {}) as Record<
    string,
    unknown
  >;
  const setField = (key: string, value: unknown) =>
    updateForm((current) => {
      const all = (current.pluginSettings ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      return {
        ...current,
        pluginSettings: {
          ...all,
          proxmox: { ...(all.proxmox ?? {}), [key]: value },
        },
      };
    });
  const sectionForm = {
    enableProxmox: values.enableProxmox === true,
    proxmoxConfig: values.proxmoxConfig ?? null,
    enableProxmoxStats: values.enableProxmoxStats === true,
    proxmoxStatsConfig: values.proxmoxStatsConfig ?? {
      pollInterval: 60,
      nodeName: null,
    },
  };
  return (
    <>
      <HostProxmoxTab
        form={sectionForm as Parameters<typeof HostProxmoxTab>[0]["form"]}
        setField={setField as Parameters<typeof HostProxmoxTab>[0]["setField"]}
      />
      <HostProxmoxStatsTab
        form={sectionForm as Parameters<typeof HostProxmoxStatsTab>[0]["form"]}
        setField={
          setField as Parameters<typeof HostProxmoxStatsTab>[0]["setField"]
        }
      />
      {/* Other plugins add Proxmox-related settings here. */}
      <ComponentSlot
        slotId="proxmox.hostEditor"
        props={{ form: sectionForm, setField }}
      />
    </>
  );
}

function ProxmoxStatsTabView({ sshHost, label, isVisible }: TabProps) {
  return (
    <ProxmoxStatsTab
      hostConfig={sshHost as unknown as SSHHost}
      title={label}
      isVisible={isVisible}
      isTopbarOpen={false}
      embedded={true}
    />
  );
}

function ProxmoxStatsStandalone({ hostId }: StandaloneViewProps) {
  return <ProxmoxStatsApp hostId={hostId} />;
}

export function activate(app: TermixApp): void {
  // The dialog lives in the hosts panel; the menu item and host action open
  // it through this, created per activation.
  const openers = new Set<Opener>();
  const openDiscover: Opener = (request) => {
    for (const open of openers) open(request);
  };

  function DiscoverDialogHost({
    hosts,
    onHostsChanged,
  }: {
    hosts: SSHHostWithStatus[];
    onHostsChanged: (hosts: SSHHostWithStatus[]) => void;
  }) {
    const [request, setRequest] = useState<DiscoverRequest | null>(null);
    useEffect(() => {
      openers.add(setRequest);
      return () => {
        openers.delete(setRequest);
      };
    }, []);
    if (!request) return null;
    return (
      <ProxmoxDiscoverDialog
        open
        onClose={() => setRequest(null)}
        hosts={hosts}
        onHostsChanged={onHostsChanged}
        preselectedHostId={request.hostId}
        defaultCredentialId={request.defaultCredentialId ?? null}
        defaultAuthType={request.defaultAuthType}
      />
    );
  }

  function ImportMenuItem() {
    const { t } = useTranslation();
    const { hosts } = useHosts();
    return (
      <DropdownMenuItem
        onClick={() => openDiscover({})}
        disabled={!hosts.some((host) => host.enableProxmox)}
      >
        <Server className="size-3.5 mr-2" />
        {t("hosts.proxmoxImportTitle")}
      </DropdownMenuItem>
    );
  }

  app.registerSlotContribution("hosts.panel", {
    actionId: "proxmox.discoverDialog",
    titleKey: "hosts.proxmoxImportTitle",
    kind: "component",
    component: DiscoverDialogHost as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  app.registerSlotContribution("hosts.importMenu", {
    actionId: "proxmox.import",
    titleKey: "hosts.proxmoxImportTitle",
    kind: "component",
    component: ImportMenuItem as ComponentType<Record<string, unknown>>,
  });

  app.registerHostAction({
    id: "proxmox-discover",
    titleKey: "hosts.proxmoxDiscoverAction",
    icon: Boxes,
    kind: "open",
    order: 90,
    when: (host) => !!host.enableProxmox,
    run: (host) => {
      const config = host.proxmoxConfig as
        | { defaultCredentialId?: number | null; defaultAuthType?: string }
        | undefined;
      openDiscover({
        hostId: Number(host.id),
        defaultCredentialId: config?.defaultCredentialId ?? null,
        defaultAuthType: config?.defaultAuthType ?? undefined,
      });
    },
  });

  app.registerHostEditorSection({
    id: "proxmox",
    group: "ssh",
    titleKey: "hosts.tabProxmox",
    icon: Server,
    order: 50,
    component: ProxmoxHostSection,
  });

  app.registerTab("proxmox-stats", ProxmoxStatsTabView, {
    icon: HardDrive,
    titleKey: "nav.proxmoxStats",
    requiresHost: true,
    noHostMessageKey: "proxmoxStats.noHostSelected",
    standalone: ProxmoxStatsStandalone,
    preload: () => import("./stats/ProxmoxStatsTab"),
  });

  app.registerHostAction({
    id: "proxmox-stats",
    titleKey: "nav.proxmoxStats",
    icon: HardDrive,
    kind: "open",
    order: 60,
    tabType: "proxmox-stats",
    copyUrlView: "proxmox-stats",
    when: (host) => host.enableProxmoxStats === true,
  });
}
