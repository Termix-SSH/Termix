import { useEffect, useRef } from "react";
import type { TabProps } from "@termix/plugin-sdk/frontend";
import { TerminalTabContent } from "@/features/terminal/TerminalTabContent";
import type { TabRenderProps } from "@/shell/tab-registry";
import type { TerminalHandle } from "@/features/terminal/terminal-types";
import { registerSession, setActiveSession } from "./session-registry";

/**
 * Wraps the core terminal tab component to register its ref in the session
 * registry, so terminal.sendToActive/sendToSession (used by the snippets
 * plugin, among others) can reach a live session without core exposing
 * terminalRef through the public tab props.
 */
export function TerminalTabWithRegistry(props: TabProps) {
  const tabRecord = props.tab as unknown as {
    id: string;
    terminalRef?: { current: TerminalHandle | null };
  };
  const host = props.host as
    | {
        id: string;
        name?: string;
        ip?: string;
        username?: string;
        port?: number;
      }
    | undefined;
  const registeredRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const tryRegister = () => {
      if (cancelled || registeredRef.current) return;
      const ref = tabRecord.terminalRef?.current;
      if (!ref) {
        if (attempts++ < 40) setTimeout(tryRegister, 250);
        return;
      }
      registeredRef.current = registerSession(
        {
          id: tabRecord.id,
          hostId: host ? Number(host.id) || null : null,
          hostName: host?.name,
          ip: host?.ip,
          username: host?.username,
          port: host?.port,
        },
        ref,
      );
    };
    tryRegister();

    return () => {
      cancelled = true;
      registeredRef.current?.();
      registeredRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRecord.id]);

  useEffect(() => {
    if (props.isFocusedPane) setActiveSession(tabRecord.id);
  }, [props.isFocusedPane, tabRecord.id]);

  return <TerminalTabContent {...(props as unknown as TabRenderProps)} />;
}
