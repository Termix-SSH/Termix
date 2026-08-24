import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  Crown,
  Loader2,
  MonitorUp,
  Presentation,
  Square,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Terminal } from "@/features/terminal/Terminal";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { getGuacamoleTokenFromHost } from "@/api/guacamole-api";
import { getSSHHosts, getUserList, type SSHHostWithStatus } from "@/main-axios";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { getErrorMessage } from "@/lib/error-message";
import {
  endCollabRoom,
  getCollabRoom,
  getCollabStage,
  inviteCollabMembers,
  presentCollabStage,
  stopCollabStage,
  type CollabRoomDetail,
  type CollabStage,
} from "@/api/collab-api";

const PING_INTERVAL_MS = 30000;
const POLL_FALLBACK_MS = 15000;

// Mirrors SharedSessionView's construction (dev/electron/prod); authentication
// rides on the jwt cookie the way every terminal WS connection does.
function roomEventsWsUrl(): string {
  const isDev =
    !isElectron() &&
    process.env.NODE_ENV === "development" &&
    (window.location.port === "3000" ||
      window.location.port === "5173" ||
      window.location.port === "");
  if (isDev) {
    return `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`;
  }
  if (isElectron()) {
    return "ws://127.0.0.1:30002";
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${window.location.host}${getBasePath()}/ssh/websocket/`;
}

type PresentDraft =
  | { protocol: "ssh"; host: SSHHostWithStatus }
  | {
      protocol: "rdp" | "vnc";
      host: SSHHostWithStatus;
      token: string;
      guacamoleConnectionId: string;
    };

export function CollabRoomTab({
  roomId,
  isVisible,
}: {
  roomId?: string;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<CollabRoomDetail | null>(null);
  const [stage, setStage] = useState<CollabStage | null>(null);
  const [ended, setEnded] = useState(false);
  const [draft, setDraft] = useState<PresentDraft | null>(null);
  const [presentOpen, setPresentOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; username: string }>>(
    [],
  );
  const [inviteSelection, setInviteSelection] = useState<Set<string>>(
    new Set(),
  );
  const draftRef = useRef<PresentDraft | null>(null);
  draftRef.current = draft;

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const nextDetail = await getCollabRoom(roomId);
      setDetail(nextDetail);
      // Presenting locally? The local session is the stage - don't join it.
      if (
        nextDetail.stage.shareId &&
        nextDetail.stage.presenterUserId !== nextDetail.me
      ) {
        const { stage: resolved } = await getCollabStage(roomId);
        setStage(resolved);
      } else if (!nextDetail.stage.shareId) {
        setStage(null);
        // The stage was cleared elsewhere; stop presenting locally too.
        if (draftRef.current) setDraft(null);
      }
    } catch {
      setEnded(true);
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live room events, with slow polling as the fallback path.
  useEffect(() => {
    if (!roomId) return;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    try {
      ws = new WebSocket(roomEventsWsUrl());
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({ type: "collab_subscribe", data: { roomId } }),
        );
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: { type?: string; roomId?: string };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.roomId !== roomId) return;
        switch (msg.type) {
          case "collab_online":
          case "collab_members_changed":
          case "collab_stage_changed":
            void refresh();
            break;
          case "collab_room_ended":
            setEnded(true);
            break;
          default:
            break;
        }
      };
    } catch {
      /* polling still covers us */
    }

    const pollTimer = setInterval(() => void refresh(), POLL_FALLBACK_MS);
    return () => {
      cancelled = true;
      if (pingTimer) clearInterval(pingTimer);
      clearInterval(pollTimer);
      ws?.close();
    };
  }, [roomId, refresh]);

  const me = detail?.me;
  const isHost = detail?.isHost ?? false;
  const presenterUserId = detail?.stage.presenterUserId ?? null;
  const iAmPresenter = !!me && presenterUserId === me;
  const onlineIds = new Set(detail?.online.map((user) => user.userId));
  const presenterName = detail?.members.find(
    (member) => member.userId === presenterUserId,
  )?.username;

  async function openPresentDialog() {
    setPresentOpen(true);
    if (hosts.length === 0) {
      try {
        setHosts(await getSSHHosts({ includeStatus: false }));
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    }
  }

  async function choosePresent(
    host: SSHHostWithStatus,
    protocol: "ssh" | "rdp" | "vnc",
  ) {
    if (!roomId) return;
    setPresentOpen(false);
    try {
      if (protocol === "ssh") {
        setDraft({ protocol, host });
        return;
      }
      const response = await getGuacamoleTokenFromHost(
        Number(host.id),
        protocol,
      );
      if (!response.guacamoleConnectionId) {
        toast.error(t("collab.stageLoading"));
        return;
      }
      setDraft({
        protocol,
        host,
        token: response.token,
        guacamoleConnectionId: response.guacamoleConnectionId,
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function registerStage(
    protocol: string,
    sessionId: string,
    hostId: number,
  ) {
    if (!roomId) return;
    try {
      await presentCollabStage(roomId, { protocol, sessionId, hostId });
      void refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
      setDraft(null);
    }
  }

  async function handleStop() {
    if (!roomId) return;
    try {
      await stopCollabStage(roomId);
      setDraft(null);
      void refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function handleEnd() {
    if (!roomId) return;
    try {
      await endCollabRoom(roomId);
      setDraft(null);
      if (!detail?.room.persistent) setEnded(true);
      void refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function openInviteDialog() {
    setInviteOpen(true);
    setInviteSelection(new Set());
    try {
      const result = await getUserList();
      setUsers(
        result.users.map((user) => ({
          id: user.userId,
          username: user.username,
        })),
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function handleInvite() {
    if (!roomId || inviteSelection.size === 0) return;
    try {
      await inviteCollabMembers(roomId, Array.from(inviteSelection));
      toast.success(t("collab.invited"));
      setInviteOpen(false);
      void refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  if (!roomId) return null;

  if (ended) {
    return (
      <div className="flex flex-1 h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <AlertCircle className="size-8" />
          <p className="text-sm">{t("collab.roomEnded")}</p>
        </div>
      </div>
    );
  }

  const memberIds = new Set(detail?.members.map((member) => member.userId));
  const invitableUsers = users.filter((user) => !memberIds.has(user.id));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: roster + controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
        <Presentation className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold truncate">
          {detail?.room.name}
        </span>
        <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
          {detail?.members.map((member) => (
            <Badge
              key={member.userId}
              variant="outline"
              className="text-[10px] gap-1"
            >
              <span
                className={`size-1.5 rounded-full ${onlineIds.has(member.userId) ? "bg-green-500" : "bg-muted-foreground/30"}`}
              />
              {member.username}
              {member.roomRole === "host" && <Crown className="size-2.5" />}
              {member.userId === presenterUserId && (
                <MonitorUp className="size-2.5 text-red-500" />
              )}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isHost && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void openInviteDialog()}
            >
              <UserPlus className="size-3.5 mr-1" />
              {t("collab.invite")}
            </Button>
          )}
          {(iAmPresenter || draft || (isHost && presenterUserId)) && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void handleStop()}
            >
              <Square className="size-3.5 mr-1" />
              {t("collab.stopPresenting")}
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => void openPresentDialog()}
          >
            <MonitorUp className="size-3.5 mr-1" />
            {presenterUserId && !iAmPresenter
              ? t("collab.takeOver")
              : t("collab.present")}
          </Button>
          {isHost && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => void handleEnd()}
            >
              {t("collab.endRoom")}
            </Button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex-1 min-h-0">
        {draft ? (
          draft.protocol === "ssh" ? (
            <CommandHistoryProvider>
              <Terminal
                hostConfig={{
                  ...draft.host,
                  id: Number(draft.host.id),
                  ip: draft.host.ip,
                  port: draft.host.port,
                  username: draft.host.username,
                  instanceId: `collab-present-${roomId}`,
                }}
                isVisible={isVisible}
                disableAutoFocus={false}
                onSessionReady={(sessionId) =>
                  void registerStage("ssh", sessionId, Number(draft.host.id))
                }
              />
            </CommandHistoryProvider>
          ) : (
            <GuacamoleDisplay
              connectionConfig={{
                token: draft.token,
                protocol: draft.protocol,
                type: draft.protocol,
              }}
              isVisible={isVisible}
              onConnect={() =>
                void registerStage(
                  draft.protocol,
                  draft.guacamoleConnectionId,
                  Number(draft.host.id),
                )
              }
              onError={(err) => {
                toast.error(err);
                setDraft(null);
              }}
            />
          )
        ) : stage && stage.protocol && !iAmPresenter ? (
          <>
            {presenterName && (
              <div className="absolute top-2 left-2 z-20 rounded px-2 py-0.5 text-[10px] bg-background/80 border border-border">
                {t("collab.presenterLabel", { name: presenterName })}
              </div>
            )}
            {stage.protocol === "ssh" ? (
              <CommandHistoryProvider>
                <Terminal
                  hostConfig={{
                    id: stage.hostId ?? undefined,
                    name: detail?.room.name ?? "stage",
                    ip: "",
                    port: 0,
                    username: "",
                    authType: "none",
                    instanceId: `collab-view-${roomId}-${stage.shareId}`,
                    joinShareId: stage.shareId,
                    joinSharedSessionId: stage.sessionId ?? null,
                  }}
                  isVisible={isVisible}
                  disableAutoFocus
                />
              </CommandHistoryProvider>
            ) : stage.connectParams?.token ? (
              <GuacamoleDisplay
                connectionConfig={{
                  token: stage.connectParams.token,
                  protocol: stage.protocol,
                  type: stage.protocol,
                }}
                isVisible={isVisible}
              />
            ) : (
              <CenteredNote text={t("collab.stageLoading")} />
            )}
          </>
        ) : iAmPresenter && !draft ? (
          <CenteredNote text={t("collab.youArePresenting")} />
        ) : (
          <CenteredNote text={t("collab.emptyStage")} />
        )}
      </div>

      {/* Present dialog */}
      <Dialog open={presentOpen} onOpenChange={setPresentOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("collab.presentTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {hosts.length === 0 && (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {hosts.map((host) => {
              const protocols: Array<"ssh" | "rdp" | "vnc"> = [];
              if (host.enableTerminal || host.enableSsh) protocols.push("ssh");
              if (host.enableRdp) protocols.push("rdp");
              if (host.enableVnc) protocols.push("vnc");
              if (protocols.length === 0) return null;
              return (
                <div
                  key={host.id}
                  className="flex items-center gap-2 px-2 py-1.5 border border-border"
                >
                  <span className="flex-1 text-xs truncate">{host.name}</span>
                  {protocols.map((protocol) => (
                    <Button
                      key={protocol}
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] uppercase"
                      onClick={() => void choosePresent(host, protocol)}
                    >
                      {protocol}
                    </Button>
                  ))}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("collab.inviteTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {invitableUsers.map((user) => (
              <label
                key={user.id}
                className="flex items-center gap-2 px-2 py-1.5 text-xs border border-border cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={inviteSelection.has(user.id)}
                  onChange={(e) => {
                    setInviteSelection((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(user.id);
                      else next.delete(user.id);
                      return next;
                    });
                  }}
                />
                {user.username}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleInvite()}
              disabled={inviteSelection.size === 0}
            >
              {t("collab.invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CenteredNote({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
