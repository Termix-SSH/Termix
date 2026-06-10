import React from "react";
import { TmuxMonitor } from "@/features/tmux-monitor/TmuxMonitor.tsx";

interface TmuxMonitorAppProps {
  hostId?: string;
}

const TmuxMonitorApp: React.FC<TmuxMonitorAppProps> = ({ hostId }) => {
  const parsed = hostId ? parseInt(hostId, 10) : NaN;
  return (
    <div className="h-screen w-screen overflow-hidden">
      <TmuxMonitor
        initialHostId={Number.isFinite(parsed) ? parsed : undefined}
      />
    </div>
  );
};

export default TmuxMonitorApp;
