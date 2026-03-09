import { HostManager } from "@/ui/desktop/apps/host-manager/hosts/HostManager";
import React from "react";

const HostManagerApp: React.FC = () => {
  return (
    <div className="w-full h-screen">
      <HostManager isTopbarOpen={false} onSelectView={() => {}} />
    </div>
  );
};

export default HostManagerApp;
