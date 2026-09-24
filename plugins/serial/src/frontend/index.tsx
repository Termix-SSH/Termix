import type { Ref } from "react";
import { Usb } from "lucide-react";
import type {
  PanelProps,
  PluginHostRecord,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { Serial } from "./Serial.js";
import { SerialPanel } from "./SerialPanel.js";
import { setSerialWsUrl } from "./transport.js";
import type { SerialConfig, SerialHandle } from "./types.js";

/**
 * A per-connection synthetic host, never a real DB host. The shell only
 * opens a genuinely hostless (host: null) tab as a singleton, and a serial
 * console is not one: a user can have several open at once, each with its
 * own device and settings. A distinct id per connection is what keeps them
 * separate tabs.
 */
function buildPseudoHost(config: SerialConfig): PluginHostRecord {
  return {
    id: `serial-${Date.now()}`,
    name: config.path
      ? `${config.path} (${config.baudRate})`
      : `Serial (${config.baudRate})`,
    ip: "",
    port: 0,
  };
}

function SerialPanelView({ shell }: PanelProps) {
  return (
    <SerialPanel
      onConnect={(config) => {
        shell.openTab(buildPseudoHost(config), "serial", {
          forceNewTab: true,
          data: { serialConfig: config },
        });
      }}
    />
  );
}

function SerialTabView({ tab, isVisible, handleRef }: TabProps) {
  const config = tab.data?.serialConfig as SerialConfig | undefined;
  if (!config) return null;
  return (
    <Serial
      ref={handleRef as Ref<SerialHandle>}
      config={config}
      isVisible={isVisible}
      instanceId={tab.id}
    />
  );
}

export function activate(app: TermixApp): void {
  setSerialWsUrl(app.wsUrl);
  app.onDispose(() => setSerialWsUrl(null));

  app.registerRailItem({
    id: "serial",
    icon: Usb,
    titleKey: "nav.serial",
    after: "quick-connect",
    separatorAfter: true,
  });

  app.registerPanel("serial", SerialPanelView);

  app.registerTab("serial", SerialTabView, {
    icon: Usb,
    titleKey: "nav.serial",
    session: true,
    // Reconnecting to a COM port automatically after a restart is not a
    // workflow anyone asked for, and there's no host to restore against
    // anyway, so a serial tab is a local, ephemeral session like the
    // desktop app's local terminal rather than something workspaces saves.
    inLayouts: false,
  });
}
