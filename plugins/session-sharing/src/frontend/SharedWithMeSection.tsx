import { useCallback, useEffect, useState } from "react";
import { SquareTerminal } from "lucide-react";
import {
  invokeAction,
  useHosts,
  usePermission,
  useTranslation,
  type PluginHostRecord,
} from "@termix/plugin-sdk/frontend";
import { Badge, Button } from "@termix/plugin-sdk/ui";
import { getSharedWithMe } from "./api";

const POLL_MS = 15_000;

interface SharedSession {
  sessionId: string;
  hostId: number;
  hostName: string;
  isConnected: boolean;
  sharedByUsername: string | null;
  permissionLevel: string | null;
  shareId: string | null;
}

function isSharedSession(value: unknown): value is SharedSession {
  const row = value as Partial<SharedSession> | null;
  return (
    !!row &&
    typeof row.sessionId === "string" &&
    typeof row.hostName === "string"
  );
}

/**
 * The active connections list's "Shared with me" section: live sessions other
 * users shared with this one, each joinable in a terminal tab.
 */
export function SharedWithMeSection({
  search = "",
  openTabData = [],
}: {
  search?: string;
  openTabData?: Array<Record<string, unknown>>;
}) {
  const { t } = useTranslation();
  const { hosts } = useHosts();
  const allowed = usePermission("use");
  const [sessions, setSessions] = useState<SharedSession[]>([]);

  const load = useCallback(() => {
    if (!allowed) return;
    getSharedWithMe()
      .then((rows) => setSessions(rows.filter(isSharedSession)))
      .catch(() => setSessions([]));
  }, [allowed]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const joined = new Set(
    openTabData
      .map((data) => data.joinSharedSessionId)
      .filter((id): id is string => typeof id === "string"),
  );
  const q = search.trim().toLowerCase();
  const visible = sessions.filter(
    (session) =>
      !joined.has(session.sessionId) &&
      (!q ||
        session.hostName.toLowerCase().includes(q) ||
        (session.sharedByUsername ?? "").toLowerCase().includes(q)),
  );
  if (!allowed || visible.length === 0) return null;

  const join = (session: SharedSession) => {
    if (!session.shareId) return;
    const host: PluginHostRecord = hosts.find(
      (candidate) => String(candidate.id) === String(session.hostId),
    ) ?? {
      id: String(session.hostId),
      name: session.hostName,
      ip: "",
      port: 0,
      username: "",
    };
    void invokeAction("terminal.open", host, {
      joinSharedSessionId: session.sessionId,
      joinShareId: session.shareId,
      label: t("connections.sharedSessionLabel", {
        hostName: session.hostName,
      }),
    });
  };

  return (
    <div className="mt-2 flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          {t("connections.sectionSharedWithMe")}
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/40">
          {visible.length}
        </span>
      </div>
      {visible.map((session) => {
        const readWrite = session.permissionLevel === "read-write";
        return (
          <div
            key={session.sessionId}
            className="group flex items-center gap-2.5 border-b border-border/40 px-3 py-2.5 last:border-b-0"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground">
              <SquareTerminal className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    session.isConnected
                      ? "bg-green-500"
                      : "bg-muted-foreground/30"
                  }`}
                />
                <span className="flex-1 truncate text-xs font-semibold text-foreground">
                  {session.hostName}
                </span>
                <Badge
                  variant="outline"
                  className={`h-4 shrink-0 border-border/60 px-1 py-0 font-mono text-[9px] ${
                    readWrite ? "text-accent-brand" : "text-muted-foreground/60"
                  }`}
                >
                  {readWrite
                    ? t("sessionSharing.permissionLevel.readWrite")
                    : t("sessionSharing.permissionLevel.readOnly")}
                </Badge>
              </div>
              <span className="truncate pl-3 text-[10px] text-muted-foreground/60">
                {t("connections.sharedBy", {
                  username: session.sharedByUsername ?? "?",
                })}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => join(session)}
            >
              {t("connections.join")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
