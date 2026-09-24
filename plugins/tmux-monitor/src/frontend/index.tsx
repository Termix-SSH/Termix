import { Layers } from "lucide-react";
import type {
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { setTmuxMonitorApi } from "./api";
import { tmuxMonitorEnabled } from "./host-tmux-monitor";
import { HostTmuxMonitorSection } from "./HostTmuxMonitorSection";
import { TmuxMonitor } from "./TmuxMonitor";
import TmuxMonitorApp from "./TmuxMonitorApp";

const VIEW_ID = "tmux_monitor";

function TmuxMonitorTab({ tab, isVisible }: TabProps) {
  const hostId = (tab.data?.hostId as number | undefined) ?? undefined;
  return <TmuxMonitor initialHostId={hostId} isVisible={isVisible} />;
}

function TmuxMonitorStandalone(props: StandaloneViewProps) {
  return <TmuxMonitorApp {...props} />;
}

export function activate(app: TermixApp): void {
  setTmuxMonitorApi(app.api);
  app.onDispose(() => setTmuxMonitorApi(null));

  // A single cross-host browser, like the old core tab: opening it from a
  // host row just points the already-open (or newly opened) tab at that host.
  app.registerTab(VIEW_ID, TmuxMonitorTab, {
    icon: Layers,
    titleKey: "nav.tmuxMonitor",
    singleton: true,
    hostless: true,
    persistent: true,
    activityTypes: ["tmux_monitor"],
    standalone: TmuxMonitorStandalone,
  });

  app.registerHostAction({
    id: "tmux_monitor",
    titleKey: "nav.tmuxMonitor",
    icon: Layers,
    kind: "open",
    order: 70,
    copyUrlView: VIEW_ID,
    when: (host) => !!host.enableSsh && tmuxMonitorEnabled(host),
    run: (host, shell) =>
      shell.openSingletonTab(VIEW_ID, { data: { hostId: Number(host.id) } }),
  });

  app.registerHostEditorSection({
    id: "tmux-monitor",
    group: "ssh",
    titleKey: "hosts.tabTmuxMonitor",
    icon: Layers,
    order: 45,
    component: HostTmuxMonitorSection,
  });
}
