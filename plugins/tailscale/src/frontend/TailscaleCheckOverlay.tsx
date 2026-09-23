import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import type { TerminalOverlayProps } from "@/features/terminal/terminal-slots";
import { TailscaleCheckDialog } from "./TailscaleCheckDialog";

/** How long Tailscale may hold a connection open waiting on approval. */
const CHECK_TIMEOUT_MS = 30 * 60 * 1000;

interface CheckState {
  authUrl: string;
  message?: string;
  stage: "prompt" | "waiting";
}

/**
 * Tailscale SSH can hold a connection open until the user approves it in a
 * browser. The terminal's server messages say when, and this pauses the
 * connect timeout and shows the approval link meanwhile.
 */
export function TailscaleCheckOverlay({
  subscribe,
  holdConnectTimeout,
  fail,
  disconnect,
  backgroundColor,
}: TerminalOverlayProps) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<CheckState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);

  useEffect(() => {
    const release = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (heldRef.current) {
        heldRef.current = false;
        holdConnectTimeout(false);
      }
      setCheck(null);
    };

    const unsubscribe = subscribe((message) => {
      if (message.type === "tailscale_check_required") {
        if (!heldRef.current) {
          heldRef.current = true;
          holdConnectTimeout(true);
        }
        setCheck({
          authUrl: typeof message.url === "string" ? message.url : "",
          message:
            typeof message.message === "string" ? message.message : undefined,
          stage: "prompt",
        });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          release();
          fail(t("terminal.tailscaleCheckTimeout"));
        }, CHECK_TIMEOUT_MS);
      } else if (
        message.type === "tailscale_check_completed" ||
        message.type === "session_closed"
      ) {
        release();
      }
    });

    return () => {
      unsubscribe();
      release();
    };
  }, [subscribe, holdConnectTimeout, fail, t]);

  if (!check) return null;

  return (
    <TailscaleCheckDialog
      isOpen
      authUrl={check.authUrl}
      message={check.message}
      stage={check.stage}
      onCancel={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        if (heldRef.current) {
          heldRef.current = false;
          holdConnectTimeout(false);
        }
        setCheck(null);
        disconnect();
      }}
      onOpenUrl={() => {
        window.open(check.authUrl, "_blank");
        setCheck((current) =>
          current ? { ...current, stage: "waiting" } : null,
        );
      }}
      backgroundColor={backgroundColor}
    />
  );
}
