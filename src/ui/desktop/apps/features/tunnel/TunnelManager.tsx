import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Tunnel } from "@/ui/desktop/apps/features/tunnel/Tunnel.tsx";
import { useTranslation } from "react-i18next";
import {
  createC2STunnelPreset,
  deleteC2STunnelPreset,
  getC2STunnelPresets,
  getSSHHosts,
  updateC2STunnelPreset,
} from "@/ui/main-axios.ts";
import { toast } from "sonner";
import type { C2STunnelPreset, TunnelConnection } from "@/types/index.js";

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  folder?: string;
  enableFileManager?: boolean;
  tunnelConnections?: unknown[];
  [key: string]: unknown;
}

interface TunnelManagerProps {
  hostConfig?: HostConfig;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

export function TunnelManager({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: TunnelManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [c2sConfig, setC2sConfig] = React.useState<TunnelConnection[]>([]);
  const [c2sPresets, setC2sPresets] = React.useState<C2STunnelPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("");
  const [presetName, setPresetName] = React.useState("");
  const isElectron =
    typeof window !== "undefined" && window.electronAPI?.isElectron === true;

  const selectedPreset = React.useMemo(
    () =>
      c2sPresets.find((preset) => String(preset.id) === selectedPresetId) ||
      null,
    [c2sPresets, selectedPresetId],
  );
  const selectedMatchesCurrent = React.useMemo(() => {
    if (!selectedPreset) return false;
    return JSON.stringify(selectedPreset.config) === JSON.stringify(c2sConfig);
  }, [selectedPreset, c2sConfig]);

  const refreshC2sPresets = React.useCallback(async () => {
    try {
      const presets = await getC2STunnelPresets();
      setC2sPresets([...presets].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      // API helper already surfaces the error.
    }
  }, []);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setCurrentHostConfig(hostConfig);
    }
  }, [hostConfig?.id]);

  React.useEffect(() => {
    if (!isElectron) return;

    const loadC2sState = async () => {
      const [localConfig, defaultName] = await Promise.all([
        window.electronAPI.getC2STunnelConfig(),
        window.electronAPI.getC2STunnelPresetDefaultName(),
      ]);
      setC2sConfig(
        Array.isArray(localConfig)
          ? (localConfig as TunnelConnection[]).filter(
              (tunnel) => tunnel.scope === "c2s",
            )
          : [],
      );
      setPresetName(defaultName);
      await refreshC2sPresets();
    };

    loadC2sState().catch(() => {
      toast.error("Failed to load local C2S tunnel settings");
    });
  }, [isElectron, refreshC2sPresets]);

  const saveLocalC2sConfig = async (config: TunnelConnection[]) => {
    const result = await window.electronAPI.saveC2STunnelConfig(config);
    if (!result.success) {
      throw new Error(result.error || "Failed to save local C2S config");
    }
    setC2sConfig(config);
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    try {
      await createC2STunnelPreset({
        name: presetName,
        config: c2sConfig,
      });
      await refreshC2sPresets();
      toast.success("C2S tunnel preset saved");
    } catch {
      // API helper already surfaces the error.
    }
  };

  const handleLoadPreset = async () => {
    if (!selectedPreset || selectedMatchesCurrent) return;
    try {
      await saveLocalC2sConfig(selectedPreset.config);
      toast.success("C2S tunnel preset loaded locally");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Load failed");
    }
  };

  const handleRenamePreset = async () => {
    if (!selectedPreset || !presetName.trim()) return;
    try {
      await updateC2STunnelPreset(selectedPreset.id, { name: presetName });
      await refreshC2sPresets();
      toast.success("C2S tunnel preset renamed");
    } catch {
      // API helper already surfaces the error.
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) return;
    try {
      await deleteC2STunnelPreset(selectedPreset.id);
      setSelectedPresetId("");
      await refreshC2sPresets();
      toast.success("C2S tunnel preset deleted");
    } catch {
      // API helper already surfaces the error.
    }
  };

  React.useEffect(() => {
    const fetchLatestHostConfig = async () => {
      if (hostConfig?.id) {
        try {
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          // Silently handle error
        }
      }
    };

    fetchLatestHostConfig();

    const handleHostsChanged = async () => {
      if (hostConfig?.id) {
        try {
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          // Silently handle error
        }
      }
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    return () =>
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
  }, [hostConfig?.id]);

  const topMarginPx = isTopbarOpen ? 74 : 16;
  const leftMarginPx = sidebarState === "collapsed" ? 16 : 8;
  const bottomMarginPx = 8;

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        marginLeft: leftMarginPx,
        marginRight: 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
      };

  const containerClass = embedded
    ? "h-full w-full text-foreground overflow-hidden bg-transparent"
    : "bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden";

  return (
    <div style={wrapperStyle} className={containerClass}>
      <div className="h-full w-full flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">
                {currentHostConfig?.folder} / {title}
              </h1>
            </div>
          </div>
          {isElectron && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                className="h-8 w-64"
                placeholder="C2S preset name"
              />
              <Button size="sm" onClick={handleSavePreset}>
                Save C2S
              </Button>
              <Select
                value={selectedPresetId}
                onValueChange={(value) => {
                  setSelectedPresetId(value);
                  const preset = c2sPresets.find(
                    (item) => String(item.id) === value,
                  );
                  if (preset) setPresetName(preset.name);
                }}
              >
                <SelectTrigger className="h-8 w-56">
                  <SelectValue placeholder="No C2S preset selected" />
                </SelectTrigger>
                <SelectContent>
                  {c2sPresets.map((preset) => (
                    <SelectItem key={preset.id} value={String(preset.id)}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={handleLoadPreset}
                disabled={!selectedPreset || selectedMatchesCurrent}
              >
                Load
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRenamePreset}
                disabled={!selectedPreset || !presetName.trim()}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDeletePreset}
                disabled={!selectedPreset}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="flex-1 overflow-hidden min-h-0 p-1">
          {currentHostConfig?.tunnelConnections &&
          currentHostConfig.tunnelConnections.length > 0 ? (
            <div className="rounded-lg h-full overflow-hidden flex flex-col min-h-0">
              <Tunnel
                filterHostKey={
                  currentHostConfig?.name &&
                  currentHostConfig.name.trim() !== ""
                    ? currentHostConfig.name
                    : `${currentHostConfig?.username}@${currentHostConfig?.ip}`
                }
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-foreground-subtle text-lg">
                  {t("tunnel.noTunnelsConfigured")}
                </p>
                <p className="text-foreground-subtle text-sm mt-2">
                  {t("tunnel.configureTunnelsInHostSettings")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
