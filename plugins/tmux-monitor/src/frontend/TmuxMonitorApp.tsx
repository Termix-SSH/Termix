import type { StandaloneViewProps } from "@termix/plugin-sdk/frontend";
import { TmuxMonitor } from "./TmuxMonitor";

/** `?view=tmux_monitor` full-screen links. */
function TmuxMonitorApp({ hostId }: StandaloneViewProps) {
  const parsed = hostId ? parseInt(hostId, 10) : NaN;
  return (
    <div className="h-screen w-screen overflow-hidden">
      <TmuxMonitor
        initialHostId={Number.isFinite(parsed) ? parsed : undefined}
      />
    </div>
  );
}

export default TmuxMonitorApp;
