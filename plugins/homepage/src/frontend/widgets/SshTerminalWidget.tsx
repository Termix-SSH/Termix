import { useState, useRef, useEffect } from "react";
import { Terminal as TerminalIcon, Play } from "lucide-react";
import {
  useTranslation,
  useHost,
  type TabHandle as TerminalHandle,
} from "@termix/plugin-sdk/frontend";

import { PluginComponent, WidgetTitle } from "@termix/plugin-sdk/ui";
import { registerWidget } from "./WidgetRegistry";
import type { SshTerminalConfig, WidgetComponentProps } from "../types.js";
import { GRID_SIZE } from "../types.js";

function SshTerminalWidget({
  widget,
  config,
}: WidgetComponentProps<SshTerminalConfig>) {
  const { t } = useTranslation();
  const host = useHost(config.hostId || undefined);
  const [started, setStarted] = useState(false);
  const terminalRef = useRef<TerminalHandle>(null);
  const terminalWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = terminalWrapRef.current;
    if (!el || !started) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", stopWheel, { capture: true, passive: true });
    return () => el.removeEventListener("wheel", stopWheel, { capture: true });
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const blurOnOutsideClick = (e: MouseEvent) => {
      if (!terminalWrapRef.current?.contains(e.target as Node)) {
        const textarea = terminalWrapRef.current?.querySelector("textarea");
        textarea?.blur();
      }
    };
    document.addEventListener("mousedown", blurOnOutsideClick, {
      capture: true,
    });
    return () =>
      document.removeEventListener("mousedown", blurOnOutsideClick, {
        capture: true,
      });
  }, [started]);

  // auto-connect after the host loads if configured
  useEffect(() => {
    if (host && config.autoConnect) setStarted(true);
  }, [host, config.autoConnect]);

  if (!config.hostId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <TerminalIcon size={20} />
        <span className="text-xs">{t("homepage.sshTerminalNoHost")}</span>
      </div>
    );
  }

  if (!host) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.sshTerminalNoHost")}
      </div>
    );
  }

  const hostConfig = {
    id: Number(host.id),
    ip: host.ip,
    port: (host.sshPort as number | undefined) ?? host.port ?? 22,
    username: host.username,
    authType: host.authType,
    terminalConfig: host.terminalConfig,
  };

  if (!started) {
    return (
      <div
        className="flex flex-col items-center justify-center w-full h-full gap-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-1">
          <TerminalIcon size={16} className="text-muted-foreground/60" />
          <span className="text-xs font-medium text-foreground">
            {host.name || host.ip}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {host.username}@{host.ip}
          </span>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-brand text-white text-xs font-medium hover:opacity-90 transition-opacity"
          onClick={() => setStarted(true)}
        >
          <Play size={11} />
          {t("homepage.sshTerminalConnect")}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={terminalWrapRef}
      className="flex flex-col w-full h-full overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <WidgetTitle title={widget.title} icon={<TerminalIcon size={11} />} />
      <div className="flex-1 overflow-hidden">
        <PluginComponent
          id="terminal.view"
          handleRef={terminalRef}
          hostConfig={hostConfig}
          isVisible={true}
          showTitle={false}
          splitScreen={false}
          disableAutoFocus={true}
          onClose={() => setStarted(false)}
        />
      </div>
    </div>
  );
}

registerWidget<SshTerminalConfig>({
  id: "ssh_terminal",
  name: "SSH Terminal",
  description: "An inline SSH terminal connected to a configured host",
  category: "system",
  icon: <TerminalIcon size={14} />,
  defaultConfig: {
    hostId: 0,
    autoConnect: false,
  },
  defaultSize: { w: GRID_SIZE * 16, h: GRID_SIZE * 12 },
  minSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 6 },
  component: SshTerminalWidget,
});
