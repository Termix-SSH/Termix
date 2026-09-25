import { useEffect, useRef, useState } from "react";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";

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
  stage: "waiting" | "error";
  error?: string;
  hostId?: unknown;
  requestId?: string;
}

/** How long the dialog waits before giving up on the connection. */
const DIALOG_TIMEOUT_MS = 300_000;

const footerButton =
  "rounded-none text-[10px] font-bold uppercase tracking-widest";

/**
 * Runs the Vault OIDC sign-in for a terminal: asks the server to start it,
 * opens Vault's auth URL in a popup, and reconnects once Vault has signed
 * the certificate.
 */
export function VaultOverlay({
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
  const popupRef = useRef<Window | null>(null);
  const heldRef = useRef(false);
  // A second "auth required" after a sign-in means the certificate did not work.
  const failedRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const closePopup = () => {
      try {
        popupRef.current?.close();
      } catch {
        // already closed
      }
      popupRef.current = null;
    };
    const hold = (held: boolean) => {
      if (heldRef.current === held) return;
      heldRef.current = held;
      holdConnectTimeout(held);
    };

    const unsubscribe = subscribe((message) => {
      switch (message.type) {
        case "vault_auth_required":
          hold(true);
          if (failedRef.current) {
            clearTimer();
            hold(false);
            setDialog({ stage: "error", error: t("dialog.failed") });
            fail(t("dialog.failed"));
          } else {
            failedRef.current = true;
            send("vault_start_auth", { hostId: message.hostId });
          }
          break;
        case "vault_auth_url":
          try {
            popupRef.current = window.open(
              String(message.url ?? ""),
              "termix-vault-oidc",
              "width=540,height=720",
            );
          } catch {
            popupRef.current = null;
          }
          setDialog({
            stage: "waiting",
            hostId: message.hostId,
            requestId:
              typeof message.requestId === "string"
                ? message.requestId
                : undefined,
          });
          clearTimer();
          timerRef.current = setTimeout(() => {
            setDialog(null);
            hold(false);
            disconnect();
          }, DIALOG_TIMEOUT_MS);
          break;
        case "vault_completed":
          clearTimer();
          closePopup();
          setDialog(null);
          send("vault_auth_completed", connectPayload());
          break;
        case "vault_error":
          failedRef.current = true;
          clearTimer();
          closePopup();
          hold(false);
          setDialog({ stage: "error", error: String(message.error ?? "") });
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
    try {
      popupRef.current?.close();
    } catch {
      // already closed
    }
    if (dialog.stage === "waiting") {
      send("vault_cancel", {
        hostId: dialog.hostId,
        requestId: dialog.requestId,
      });
    }
    setDialog(null);
    if (heldRef.current) {
      heldRef.current = false;
      holdConnectTimeout(false);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-md mx-4 relative z-10">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {dialog.stage === "error"
                ? t("dialog.failed")
                : t("dialog.title")}
            </h3>
          </div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          {dialog.stage === "waiting" ? (
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="size-4 animate-spin text-accent-brand shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t("dialog.description")}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 border border-destructive/20 bg-destructive/10">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive/90 whitespace-pre-wrap break-words">
                {dialog.error || t("dialog.failed")}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {dialog.stage === "waiting" && (
              <Button
                type="button"
                variant="outline"
                className={footerButton}
                onClick={() => {
                  try {
                    popupRef.current?.focus();
                  } catch {
                    // popup gone
                  }
                }}
              >
                {t("dialog.reopen")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className={footerButton}
              onClick={close}
            >
              {dialog.stage === "error"
                ? t("common.close")
                : t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
