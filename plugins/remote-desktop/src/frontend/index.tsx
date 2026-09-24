import type { ComponentType, Ref } from "react";
import i18next from "i18next";
import { toast } from "sonner";
import {
  MessagesSquare,
  Monitor,
  MonitorUp,
  MousePointerClick,
  Settings,
} from "lucide-react";
import {
  useTranslation,
  type HostEditorSectionProps,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { FakeSwitch, SectionCard, SettingRow } from "@termix/plugin-sdk/ui";
import type { Host } from "@/types/ui-types";
import { isQuickConnectHost } from "@/sidebar/quick-connect-host";
import GuacamoleApp, { type GuacamoleAppHandle } from "./GuacamoleApp";
import { GuacamoleDisplay } from "./GuacamoleDisplay";
import {
  HostEditorRdpTab,
  HostEditorTelnetTab,
  HostEditorVncTab,
} from "./HostEditorGuacamoleTabs";
import { getGuacamoleTokenFromHost } from "./guacamole-api";
import { quickConnectGuacHost } from "./quick-connect-guac-host";
import { REMOTE_DESKTOP_TOOLBAR_SLOT } from "./GuacamoleToolbar.tsx";

type Protocol = "rdp" | "vnc" | "telnet";

const PROTOCOLS: {
  id: Protocol;
  titleKey: string;
  icon: ComponentType<{ className?: string }>;
  enableKey: "enableRdp" | "enableVnc" | "enableTelnet";
  priority: number;
  order: number;
}[] = [
  {
    id: "rdp",
    titleKey: "hosts.tabRdp",
    icon: Monitor,
    enableKey: "enableRdp",
    priority: 50,
    order: 100,
  },
  {
    id: "vnc",
    titleKey: "hosts.tabVnc",
    icon: MousePointerClick,
    enableKey: "enableVnc",
    priority: 40,
    order: 110,
  },
  {
    id: "telnet",
    titleKey: "hosts.tabTelnet",
    icon: MessagesSquare,
    enableKey: "enableTelnet",
    priority: 30,
    order: 120,
  },
];

function RemoteDesktopTab({ tab, host, isVisible, handleRef }: TabProps) {
  const shellHost = host as unknown as Host;
  return (
    <GuacamoleApp
      ref={handleRef as Ref<GuacamoleAppHandle>}
      hostId={String(host?.id ?? "")}
      tabId={tab.id}
      protocol={tab.type as Protocol}
      isVisible={isVisible}
      quickConnectHost={
        isQuickConnectHost(shellHost)
          ? quickConnectGuacHost(shellHost)
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

/** Applies one remote desktop field and stops inheriting user defaults. */
function useGuacFieldSetter(
  updateForm: HostEditorSectionProps["updateForm"],
): (key: string, value: unknown) => void {
  return (key, value) =>
    updateForm((current) => ({
      inheritRemoteDesktopDefaults: false,
      guacamoleConfig: {
        ...((current.guacamoleConfig as Record<string, unknown>) ?? {}),
        [key]: value,
      },
    }));
}

function RdpSection(props: HostEditorSectionProps) {
  const { t } = useTranslation();
  const setGuacField = useGuacFieldSetter(props.updateForm);
  return (
    <>
      <SectionCard
        title={t("hosts.rdpDefaults", { defaultValue: "RDP defaults" })}
        icon={<Settings className="size-3.5" />}
      >
        <SettingRow
          label={t("hosts.useUserDefaults", {
            defaultValue: "Use user defaults",
          })}
          description={t("hosts.useUserRdpDefaultsDesc", {
            defaultValue:
              "Inherit performance, redirection, and clipboard settings from User Profile.",
          })}
        >
          <FakeSwitch
            checked={!!props.form.inheritRemoteDesktopDefaults}
            onChange={(value) =>
              props.setField("inheritRemoteDesktopDefaults", value)
            }
          />
        </SettingRow>
      </SectionCard>
      <HostEditorRdpTab
        form={props.form}
        setField={props.setField as never}
        setGuacField={setGuacField as never}
        host={props.host as unknown as Host}
        credentials={props.credentials as never}
      />
    </>
  );
}

function VncSection(props: HostEditorSectionProps) {
  const setGuacField = useGuacFieldSetter(props.updateForm);
  return (
    <HostEditorVncTab
      form={props.form}
      setField={props.setField as never}
      setGuacField={setGuacField as never}
      host={props.host as unknown as Host}
      credentials={props.credentials as never}
    />
  );
}

function TelnetSection(props: HostEditorSectionProps) {
  const setGuacField = useGuacFieldSetter(props.updateForm);
  return (
    <HostEditorTelnetTab
      form={props.form}
      setField={props.setField as never}
      setGuacField={setGuacField as never}
      credentials={props.credentials as never}
    />
  );
}

const SECTIONS: Record<Protocol, ComponentType<HostEditorSectionProps>> = {
  rdp: RdpSection,
  vnc: VncSection,
  telnet: TelnetSection,
};

async function openNativeRdp(host: Record<string, unknown>): Promise<void> {
  const t = (key: string) => i18next.t(`remote-desktop:${key}`);
  try {
    const result = await window.electronAPI.openNativeRdp({
      host: String(host.ip),
      port: (host.rdpPort as number | undefined) ?? 3389,
      username: host.rdpUser as string | undefined,
      domain: host.domain as string | undefined,
    });
    if (result.success) toast.success(t("hosts.nativeRdpOpened"));
    else toast.error(result.error || t("hosts.nativeRdpFailed"));
  } catch {
    toast.error(t("hosts.nativeRdpFailed"));
  }
}

export function activate(app: TermixApp): void {
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
      restore: (host) => !!host[protocol.enableKey],
      activityTypes: [protocol.id],
      standalone: RemoteDesktopStandalone,
      preload: () => import("./GuacamoleApp"),
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
      when: (host) => !!host[protocol.enableKey],
    });

    app.registerHostEditorSection({
      id: protocol.id,
      group: "top",
      titleKey: protocol.titleKey,
      icon: protocol.icon,
      order: protocol.order / 5,
      visible: (protocols) => !!protocols[protocol.enableKey],
      component: SECTIONS[protocol.id],
    });
  }

  // The desktop app on Windows can hand RDP to the system client instead.
  if (window.electronAPI?.isElectron) {
    let disposed = false;
    app.onDispose(() => {
      disposed = true;
    });
    window.electronAPI
      .getPlatform()
      .then((platform: string) => {
        if (disposed || platform !== "win32") return;
        app.registerHostAction({
          id: "rdp-native",
          titleKey: "hosts.openNativeRdp",
          icon: MonitorUp,
          kind: "open",
          order: 105,
          when: (host) => !!host.enableRdp,
          run: (host) => void openNativeRdp(host),
        });
      })
      .catch(() => {});
  }

  app.registerSlotContribution("onboarding.features", {
    actionId: "remote-desktop.feature",
    titleKey: "onboarding.feature_desktop",
    descriptionKey: "onboarding.feature_desktop_desc",
    icon: Monitor,
  });
}
