import { C2STunnelPresetManager } from "@/user/C2STunnelPresetManager";

export function PortForwardingPanel() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-2">
      <C2STunnelPresetManager />
    </div>
  );
}
