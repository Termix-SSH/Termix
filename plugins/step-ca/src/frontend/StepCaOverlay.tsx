import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { StepCaDialog, type SignInStage } from "./StepCaDialog";

/** What the ssh-terminal plugin hands a "terminal.overlay" component. */
export interface TerminalOverlayProps {
  host: { id: number | string; [key: string]: unknown } | undefined;
  backgroundColor?: string;
  subscribe: (
    listener: (message: { type: string; [key: string]: unknown }) => void,
  ) => () => void;
  holdConnectTimeout: (held: boolean) => void;
  fail: (message: string) => void;
  disconnect: () => void;
  send: (type: string, data?: unknown) => void;
  connectPayload: () => Record<string, unknown>;
}

interface DialogState {
  authUrl: string;
  requestId: string;
  stage: SignInStage;
  error?: string;
}

/** How long the sign-in dialog waits before giving up on the connection. */
const DIALOG_TIMEOUT_MS = 300_000;

/**
 * Runs the Step CA browser sign-in for a terminal: asks the server to start
 * it, opens the identity provider, and reconnects once the CA has issued the
 * certificate.
 */
export function StepCaOverlay({
  subscribe,
  holdConnectTimeout,
  fail,
  disconnect,
  send,
  connectPayload,
  backgroundColor,
}: TerminalOverlayProps) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  // A second "auth required" after a sign-in means the certificate did not work.
  const failedRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const hold = (held: boolean) => {
      if (heldRef.current === held) return;
      heldRef.current = held;
      holdConnectTimeout(held);
    };
    const showError = (requestId: unknown, error: string) => {
      clearTimer();
      setDialog((current) =>
        current
          ? { ...current, stage: "error", error }
          : {
              authUrl: "",
              requestId: typeof requestId === "string" ? requestId : "",
              stage: "error",
              error,
            },
      );
    };

    const unsubscribe = subscribe((message) => {
      switch (message.type) {
        case "stepca_auth_required":
          hold(true);
          if (failedRef.current) {
            clearTimer();
            setDialog(null);
            hold(false);
            fail(t("errors.authFailed"));
          } else {
            failedRef.current = true;
            send("stepca_start_auth", { hostId: message.hostId });
          }
          break;
        case "stepca_status":
          if (message.stage === "chooser") {
            setDialog({
              authUrl: typeof message.url === "string" ? message.url : "",
              requestId:
                typeof message.requestId === "string" ? message.requestId : "",
              stage: "chooser",
            });
            clearTimer();
            timerRef.current = setTimeout(() => {
              setDialog(null);
              hold(false);
              disconnect();
            }, DIALOG_TIMEOUT_MS);
          } else {
            setDialog((current) =>
              current
                ? { ...current, stage: message.stage as SignInStage }
                : null,
            );
          }
          break;
        case "stepca_completed":
          clearTimer();
          setDialog(null);
          send("stepca_auth_completed", connectPayload());
          break;
        case "stepca_error":
          failedRef.current = true;
          showError(message.requestId, String(message.error ?? ""));
          break;
        case "stepca_timeout":
          failedRef.current = true;
          showError(message.requestId, t("errors.timeout"));
          break;
        case "stepca_config_error":
          showError(message.requestId, String(message.error ?? ""));
          break;
        case "connected":
        case "sessionAttached":
          failedRef.current = false;
          hold(false);
          break;
        case "session_closed":
          clearTimer();
          setDialog(null);
          hold(false);
          break;
      }
    });

    return () => {
      unsubscribe();
      clearTimer();
      if (heldRef.current) {
        heldRef.current = false;
        holdConnectTimeout(false);
      }
    };
  }, [
    subscribe,
    holdConnectTimeout,
    fail,
    disconnect,
    send,
    connectPayload,
    t,
  ]);

  if (!dialog) return null;

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (dialog.requestId) {
      send("stepca_cancel", { requestId: dialog.requestId });
    }
    setDialog(null);
    if (heldRef.current) {
      heldRef.current = false;
      holdConnectTimeout(false);
    }
  };

  return (
    <StepCaDialog
      stage={dialog.stage}
      error={dialog.error}
      onCancel={close}
      onOpenUrl={() => {
        if (!dialog.authUrl) return;
        window.open(dialog.authUrl, "_blank");
        setDialog((current) =>
          current ? { ...current, stage: "waiting" } : null,
        );
      }}
      backgroundColor={backgroundColor}
    />
  );
}
