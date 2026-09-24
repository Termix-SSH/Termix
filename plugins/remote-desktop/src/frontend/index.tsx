import type { ComponentType, Ref } from "react";
import {
  Info,
  MessagesSquare,
  Monitor,
  MonitorUp,
  MousePointerClick,
} from "lucide-react";
import {
  useTranslation,
  type HostEditorSectionProps,
  type PluginHostRecord,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { SectionCard, isElectron } from "@termix/plugin-sdk/ui";
import { toast } from "sonner";
import GuacamoleApp, { type GuacamoleAppHandle } from "./GuacamoleApp";
import { GuacamoleDisplay } from "./GuacamoleDisplay";
import {
  HostEditorRdpTab,
  HostEditorTelnetTab,
  HostEditorVncTab,
} from "./HostEditorGuacamoleTabs";
import {
  getGuacamoleTokenFromHost,
  getGuacdStatus,
  nativeRdpAvailable,
  openNativeRdp,
  setRemoteDesktopApp,
} from "./guacamole-api";
import { quickConnectGuacHost } from "./quick-connect-guac-host";
import { REMOTE_DESKTOP_TOOLBAR_SLOT } from "./GuacamoleToolbar.tsx";
import {
  DEFAULT_PORT,
  ENABLE_KEY,
  PORT_KEY,
  hostRemoteOptions,
  isQuickConnectHost,
  protocolEnabled,
  type Protocol,
  type RemoteHostLogin,
} from "./host-remote";
import { remoteDesktopForm } from "./remote-form";

const PROTOCOLS: {
  id: Protocol;
  titleKey: string;
  descriptionKey: string;
  paletteKey: string;
  icon: ComponentType<{ className?: string }>;
  priority: number;
  order: number;
  quickConnect?: { showDomain?: boolean };
}[] = [
  {
    id: "rdp",
    titleKey: "hosts.tabRdp",
    descriptionKey: "hosts.remoteDesktop",
    paletteKey: "palette.connectRdp",
    icon: Monitor,
    priority: 50,
    order: 100,
    quickConnect: { showDomain: true },
  },
  {
    id: "vnc",
    titleKey: "hosts.tabVnc",
    descriptionKey: "hosts.virtualNetwork",
    paletteKey: "palette.connectVnc",
    icon: MousePointerClick,
    priority: 40,
    order: 110,
    quickConnect: {},
  },
  {
    id: "telnet",
    titleKey: "hosts.tabTelnet",
    descriptionKey: "hosts.unencryptedShell",
    paletteKey: "palette.connectTelnet",
    icon: MessagesSquare,
    priority: 30,
    order: 120,
  },
];

function RemoteDesktopTab({ tab, host, isVisible, handleRef }: TabProps) {
  const record = host as unknown as RemoteHostLogin | undefined;
  return (
    <GuacamoleApp
      ref={handleRef as Ref<GuacamoleAppHandle>}
      hostId={String(host?.id ?? "")}
      tabId={tab.id}
      protocol={tab.type as Protocol}
      isVisible={isVisible}
      quickConnectHost={
        record && isQuickConnectHost(record)
          ? quickConnectGuacHost(record)
          : undefined
      }
    />
  );
}

function RemoteDesktopStandalone({ hostId, view }: StandaloneViewProps) {
  return <GuacamoleApp hostId={hostId} protocol={view as Protocol} />;
}

/** What collab rooms and shared-session links draw a stream with. */
function RemoteDisplay({
  token,
  protocol,
  isVisible,
  onConnect,
  onError,
}: {
  token: string;
  protocol: Protocol;
  isVisible: boolean;
  onConnect?: () => void;
  onError?: (error: string) => void;
}) {
  return (
    <GuacamoleDisplay
      connectionConfig={{ token, protocol, type: protocol }}
      isVisible={isVisible}
      onConnect={onConnect}
      onError={onError}
    />
  );
}

function SectionNotes({ protocol }: { protocol: Protocol }) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("hosts.remoteDesktopNotes")}
      icon={<Info className="size-3.5" />}
    >
      <div className="flex flex-col gap-2 py-3 text-xs text-muted-foreground">
        {protocol === "rdp" && <p>{t("hosts.userDefaultsNote")}</p>}
        {isElectron() && <p>{t("hosts.connectionOriginNote")}</p>}
      </div>
    </SectionCard>
  );
}

function RdpSection(props: HostEditorSectionProps) {
  const { form, setField, setGuacField } = remoteDesktopForm(props);
  return (
    <>
      <HostEditorRdpTab
        form={form}
        setField={setField}
        setGuacField={setGuacField}
        host={props.host as { macAddress?: string | null } | undefined}
        credentials={props.credentials as never}
      />
      <SectionNotes protocol="rdp" />
    </>
  );
}

function VncSection(props: HostEditorSectionProps) {
  const { form, setField, setGuacField } = remoteDesktopForm(props);
  return (
    <>
      <HostEditorVncTab
        form={form}
        setField={setField}
        setGuacField={setGuacField}
        host={props.host as { macAddress?: string | null } | undefined}
        credentials={props.credentials as never}
      />
      <SectionNotes protocol="vnc" />
    </>
  );
}

function TelnetSection(props: HostEditorSectionProps) {
  const { form, setField, setGuacField } = remoteDesktopForm(props);
  return (
    <>
      <HostEditorTelnetTab
        form={form}
        setField={setField}
        setGuacField={setGuacField}
        credentials={props.credentials as never}
      />
      <SectionNotes protocol="telnet" />
    </>
  );
}

const SECTIONS: Record<Protocol, ComponentType<HostEditorSectionProps>> = {
  rdp: RdpSection,
  vnc: VncSection,
  telnet: TelnetSection,
};

function registerNativeRdp(app: TermixApp): void {
  let disposed = false;
  app.onDispose(() => {
    disposed = true;
  });
  void nativeRdpAvailable().then((available) => {
    if (disposed || !available) return;
    app.registerHostAction({
      id: "rdp-native",
      titleKey: "hosts.openNativeRdp",
      icon: MonitorUp,
      kind: "open",
      order: 105,
      when: (host) => protocolEnabled(host, "rdp"),
      run: (host) => {
        const record = host as unknown as RemoteHostLogin;
        void openNativeRdp({
          host: String(record.ip ?? ""),
          port: hostRemoteOptions(record).rdpPort,
          username: record.rdpUser,
          domain: record.domain,
        })
          .then((result) => {
            if (result.success) toast.success(app.t("hosts.nativeRdpOpened"));
            else toast.error(result.error || app.t("hosts.nativeRdpFailed"));
          })
          .catch(() => toast.error(app.t("hosts.nativeRdpFailed")));
      },
    });
  });
}

function registerHostSurfaces(app: TermixApp): void {
  for (const protocol of PROTOCOLS) {
    const when = (host: PluginHostRecord) => protocolEnabled(host, protocol.id);

    app.registerHostProtocol({
      id: protocol.id,
      settingKey: ENABLE_KEY[protocol.id],
      portKey: PORT_KEY[protocol.id],
      defaultPort: DEFAULT_PORT[protocol.id],
      titleKey: protocol.titleKey,
      descriptionKey: protocol.descriptionKey,
      icon: protocol.icon,
      order: protocol.order,
      quickConnect: protocol.quickConnect,
    });

    app.registerHostAction({
      id: protocol.id,
      titleKey: protocol.titleKey,
      icon: protocol.icon,
      kind: "connect",
      priority: protocol.priority,
      order: protocol.order,
      tabType: protocol.id,
      copyUrlView: protocol.id,
      when,
    });

    app.registerPaletteEntry({
      id: `remote-desktop.${protocol.id}`,
      titleKey: protocol.paletteKey,
      icon: protocol.icon,
      keywords: [protocol.id],
      scope: "host",
      when: (host) => !!host && when(host),
      run: (shell, host) => {
        if (host) shell.openTab(host, protocol.id);
      },
    });

    app.registerHostEditorSection({
      id: protocol.id,
      group: "top",
      titleKey: protocol.titleKey,
      icon: protocol.icon,
      order: protocol.order / 5,
      visible: (protocols) => !!protocols[ENABLE_KEY[protocol.id]],
      component: SECTIONS[protocol.id],
    });
  }

  if (isElectron()) registerNativeRdp(app);
}

export function activate(app: TermixApp): void {
  setRemoteDesktopApp(app);
  app.onDispose(() => setRemoteDesktopApp(null));

  // Guest pages only draw shared streams.
  app.registerSlotContribution("session.remoteDisplay", {
    actionId: "remote-desktop.display",
    titleKey: "hosts.tabRdp",
    kind: "component",
    component: RemoteDisplay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });
  if (app.guest) return;

  // The share button lives here, contributed by session sharing.
  app.declareActionSlot({
    id: REMOTE_DESKTOP_TOOLBAR_SLOT,
    accepts: ["button"],
  });

  // Mints a token for presenting a host in a collab room.
  app.registerAction(
    "session.remoteDisplay.token",
    async (hostId: number, origin: unknown, protocol: Protocol) => {
      const response = await getGuacamoleTokenFromHost(
        hostId,
        origin as Parameters<typeof getGuacamoleTokenFromHost>[1],
        protocol,
      );
      return response.guacamoleConnectionId
        ? {
            token: response.token,
            connectionId: response.guacamoleConnectionId,
          }
        : null;
    },
  );

  for (const protocol of PROTOCOLS) {
    app.registerTab(protocol.id, RemoteDesktopTab, {
      icon: protocol.icon,
      titleKey: protocol.titleKey,
      requiresHost: true,
      noHostMessageKey: "remoteDesktop.noHostSelected",
      persistent: true,
      session: true,
      restore: (host) => protocolEnabled(host, protocol.id),
      activityTypes: [protocol.id],
      standalone: RemoteDesktopStandalone,
      preload: () => import("./GuacamoleApp"),
    });
  }

  // An admin can turn Remote Desktop off; its ways in go with it.
  let disposed = false;
  app.onDispose(() => {
    disposed = true;
  });
  void getGuacdStatus("local", { probe: false })
    .then((status) => status.enabled !== false)
    .catch(() => true)
    .then((enabled) => {
      if (!disposed && enabled) registerHostSurfaces(app);
    });

  app.registerSlotContribution("onboarding.features", {
    actionId: "remote-desktop.feature",
    titleKey: "onboarding.feature_desktop",
    descriptionKey: "onboarding.feature_desktop_desc",
    icon: Monitor,
  });
}
