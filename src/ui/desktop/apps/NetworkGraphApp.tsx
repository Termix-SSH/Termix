import { NetworkGraphCard } from "@/ui/desktop/apps/dashboard/cards/NetworkGraphCard";
import React from "react";

const NetworkGraphApp: React.FC = () => {
  return (
    <div className="w-full h-screen flex flex-col">
      <NetworkGraphCard />
    </div>
  );
};

export default NetworkGraphApp;
