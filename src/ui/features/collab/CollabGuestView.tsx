import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Presentation } from "lucide-react";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { GuestTerminalView } from "@/features/session-sharing/SharedSessionView";
import {
  resolveCollabGuestStage,
  type CollabGuestStage,
} from "@/api/collab-api";

const POLL_MS = 5000;

/**
 * Anonymous guest page for a collab room (?view=collab-guest&token=...).
 * Guests have no account and no event channel, so they poll the public
 * resolve endpoint and remount the viewer whenever the stage share changes.
 */
export default function CollabGuestView() {
  const { t } = useTranslation();
  const token = new URLSearchParams(window.location.search).get("token");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [stage, setStage] = useState<CollabGuestStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageShareIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(t("collab.guest.linkInvalid"));
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await resolveCollabGuestStage(token);
        if (cancelled) return;
        setRoomName(result.roomName);
        setError(null);
        const nextShareId = result.stage?.shareId ?? null;
        // Tokens are minted per resolve; only swap the viewer on a real change.
        if (nextShareId !== stageShareIdRef.current) {
          stageShareIdRef.current = nextShareId;
          setStage(result.stage);
        }
      } catch {
        if (!cancelled) setError(t("collab.guest.linkInvalid"));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, t]);

  return (
    <div
      className="flex flex-col h-screen w-screen"
      style={{ backgroundColor: "var(--bg-base)", color: "var(--foreground)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm">
        <Presentation className="size-4 text-muted-foreground" />
        <span className="font-semibold">
          {roomName ?? t("collab.guest.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("sessionSharing.guestView.readOnlyBadge")}
        </span>
      </div>
      <div className="relative flex-1 min-h-0">
        {error ? (
          <Note icon={<AlertCircle className="size-8" />} text={error} />
        ) : !stage ? (
          <Note
            icon={<Presentation className="size-8" />}
            text={t("collab.guest.waiting")}
          />
        ) : stage.protocol === "ssh" ? (
          <GuestTerminalView
            key={stage.shareId}
            share={{ permissionLevel: "read-only" }}
            wsQuery={`roomGuestToken=${encodeURIComponent(token ?? "")}`}
          />
        ) : stage.connectParams?.token ? (
          <GuacamoleDisplay
            key={stage.shareId}
            connectionConfig={{
              token: stage.connectParams.token,
              protocol: stage.protocol,
              type: stage.protocol,
            }}
            isVisible
          />
        ) : null}
      </div>
    </div>
  );
}

function Note({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}
