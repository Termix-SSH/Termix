import { useEffect, useState, type ComponentType, type Ref } from "react";
import {
  Info,
  MessagesSquare,
  Monitor,
  MonitorUp,
  MousePointerClick,
} from "lucide-react";
import {
  invokeAction,
  useTranslation,
  type HostEditorSectionProps,
  type PluginHostRecord,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import {
  FakeSwitch,
  HostFeatureFields,
  SectionCard,
  SettingRow,
  isElectron,
} from "@termix/plugin-sdk/ui";
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
  rdpDomain,
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
  const record: RemoteHostLogin | undefined = host;
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
  connectionOrigin,
  protocol,
  isVisible,
  onConnect,
  onError,
}: {
  token: string;
  connectionOrigin?: "local" | "remote";
  protocol: Protocol;
  isVisible: boolean;
  onConnect?: () => void;
  onError?: (error: string) => void;
}) {
  return (
    <GuacamoleDisplay
      connectionConfig={{ token, protocol, type: protocol, connectionOrigin }}
      isVisible={isVisible}
      onConnect={onConnect}
      onError={onError}
    />
  );
}

function SectionNotes() {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("hosts.remoteDesktopNotes")}
      icon={<Info className="size-3.5" />}
    >
      <div className="flex flex-col gap-2 py-3 text-xs text-muted-foreground">
        <p>{t("hosts.userDefaultsNote")}</p>
        {isElectron() && <p>{t("hosts.connectionOriginNote")}</p>}
      </div>
    </SectionCard>
  );
}

function ToolbarCard({
  form,
  setField,
}: Pick<ReturnType<typeof remoteDesktopForm>, "form" | "setField">) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("hosts.guac.toolbar")}
      icon={<MonitorUp className="size-3.5" />}
    >
      <SettingRow
        label={t("settings.host.enableToolbar.label")}
        description={t("settings.host.enableToolbar.description")}
        defaultKey="enableToolbar"
      >
        <FakeSwitch
          checked={form.enableToolbar}
          onChange={(value) => setField("enableToolbar", value)}
        />
      </SettingRow>
    </SectionCard>
  );
}

/**
 * The Wake-on-LAN address a host keeps, the default for a session's wake
 * packet. Null while that plugin is off.
 */
function useWakeOnLanMac(hostId: string | undefined): string | null {
  const [mac, setMac] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!hostId) {
      setMac(null);
      return;
    }
    invokeAction("wakeOnLan.macAddress", hostId)
      .then((value) => {
        if (active) setMac(typeof value === "string" && value ? value : null);
      })
      .catch(() => {
        if (active) setMac(null);
      });
    return () => {
      active = false;
    };
  }, [hostId]);
  return mac;
}

function RdpSection(props: HostEditorSectionProps) {
  const { form, setField, setGuacField } = remoteDesktopForm(props);
  const macAddress = useWakeOnLanMac(props.host?.id);
  return (
    <>
      <HostEditorRdpTab
        form={form}
        setField={setField}
        setGuacField={setGuacField}
        host={{ macAddress }}
        credentials={props.credentials as never}
      />
      <ToolbarCard form={form} setField={setField} />
      <SectionNotes />
    </>
  );
}

function VncSection(props: HostEditorSectionProps) {
  const { form, setField, setGuacField } = remoteDesktopForm(props);
  const macAddress = useWakeOnLanMac(props.host?.id);
  return (
    <>
      <HostEditorVncTab
        form={form}
        setField={setField}
        setGuacField={setGuacField}
        host={{ macAddress }}
        credentials={props.credentials as never}
      />
      <ToolbarCard form={form} setField={setField} />
      <SectionNotes />
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
      <ToolbarCard form={form} setField={setField} />
      <SectionNotes />
    </>
  );
}

/**
 * The defaults editor's remote desktop section: the display settings and the
 * toolbar, which every host follows unless its own guacd settings say
 * otherwise. A host edits these in its protocol tabs instead.
 */
function DisplayDefaultsSection(props: HostEditorSectionProps) {
  const { t } = useTranslation();
  const { form, setField } = remoteDesktopForm(props);
  return (
    <>
      <SectionCard
        title={t("settings.host.displayGroup")}
        icon={<Monitor className="size-3.5" />}
      >
        <HostFeatureFields form={props.form} updateForm={props.updateForm} />
      </SectionCard>
      <ToolbarCard form={form} setField={setField} />
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
        const record: RemoteHostLogin = host;
        void openNativeRdp({
          host: String(record.ip ?? ""),
          port: hostRemoteOptions(record).rdpPort,
          username: record.protocolAuth?.rdp?.username ?? undefined,
          domain: rdpDomain(record),
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
      connectionOriginNoteKey: "hosts.connectionOriginGuacamoleNote",
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

  app.registerHostEditorSection({
    id: "remote-desktop-display",
    group: "top",
    titleKey: "settings.host.displayDefaultsTab",
    icon: Monitor,
    order: 40,
    defaults: "only",
    component: DisplayDefaultsSection,
  });

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
