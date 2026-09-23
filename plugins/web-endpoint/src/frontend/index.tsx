import { Globe } from "lucide-react";
import i18next from "i18next";
import { toast } from "sonner";
import type {
  HostEditorSectionProps,
  PluginHostRecord,
  ShellApi,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type { Host } from "@/types/ui-types";
import type { WebEndpoint } from "@/types";
import { WebEndpointTab } from "./WebEndpointTab";
import { HostWebUiTab } from "./HostWebUiTab";
import {
  openWebEndpointExternally,
  setWebEndpointApi,
} from "./web-endpoint-api";

const TAB_TYPE = "web-endpoint";

function endpointsOf(host: PluginHostRecord): WebEndpoint[] {
  if (!host.enableWebUi) return [];
  const config = host.webUiConfig as { endpoints?: WebEndpoint[] } | undefined;
  return config?.endpoints ?? [];
}

function openEndpoint(
  host: PluginHostRecord,
  endpoint: WebEndpoint,
  shell: ShellApi,
): void {
  if (endpoint.render === "external") {
    // No tab at all: the real browser opens it. On the desktop the main
    // process routes it to shell.openExternal.
    openWebEndpointExternally(
      host as unknown as { id: string; ip: string },
      endpoint,
    ).catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : i18next.t("web-endpoint:hosts.webUiOpenFailed"),
      );
    });
    return;
  }
  shell.openTab(host, TAB_TYPE, {
    label: endpoint.label,
    data: { endpointId: endpoint.id },
  });
}

function EndpointTab({ host, tab }: TabProps) {
  // Resolved against the host on every render, so an endpoint deleted while
  // its tab is open shows a plain message instead of throwing.
  const endpointId = tab.data?.endpointId;
  return (
    <WebEndpointTab
      host={host as unknown as Host}
      endpointId={typeof endpointId === "string" ? endpointId : undefined}
    />
  );
}

function WebUiSection({ form, setField, protocols }: HostEditorSectionProps) {
  return (
    <HostWebUiTab
      form={form}
      setField={setField as Parameters<typeof HostWebUiTab>[0]["setField"]}
      protocols={
        protocols as unknown as Parameters<typeof HostWebUiTab>[0]["protocols"]
      }
    />
  );
}

export function activate(app: TermixApp): void {
  setWebEndpointApi(app.api);
  app.onDispose(() => setWebEndpointApi(null));

  app.registerTab(TAB_TYPE, EndpointTab, {
    icon: Globe,
    titleKey: "hosts.tabWebUi",
    requiresHost: true,
    noHostMessageKey: "webEndpoint.noHostSelected",
    // A restored tab could never hold a valid URL: the backend closes an idle
    // tunnel after ten minutes and binds a fresh port on the next open. So
    // these tabs are session-only and never saved.
    persistent: false,
    inLayouts: false,
  });

  // One entry per host, not one per endpoint: with several it opens a picker.
  // Gated on enableWebUi alone, since a direct endpoint needs no SSH.
  app.registerHostAction({
    id: TAB_TYPE,
    titleKey: "hosts.tabWebUi",
    icon: Globe,
    kind: "open",
    order: 80,
    when: (host) => endpointsOf(host).length > 0,
    label: (host) => {
      const endpoints = endpointsOf(host);
      return endpoints.length === 1 ? endpoints[0].label : undefined;
    },
    items: (host) =>
      endpointsOf(host).map((endpoint) => ({
        id: endpoint.id,
        label: endpoint.label,
        run: (target, shell) => openEndpoint(target, endpoint, shell),
      })),
  });

  app.registerHostEditorSection({
    id: "web-ui",
    group: "ssh",
    titleKey: "hosts.tabWebUi",
    icon: Globe,
    order: 40,
    component: WebUiSection,
  });
}
