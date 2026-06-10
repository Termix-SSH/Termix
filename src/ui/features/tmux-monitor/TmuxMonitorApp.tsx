import React from "react";
import { TmuxMonitor } from "@/features/tmux-monitor/TmuxMonitor.tsx";

const TmuxMonitorApp: React.FC = () => {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <TmuxMonitor />
    </div>
  );
};

export default TmuxMonitorApp;
