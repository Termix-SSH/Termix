import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  Hand,
  Link2,
  Loader2,
  MonitorUp,
  Presentation,
  Square,
  Users,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import { Input } from "@/components/input";
import { CollabMembersSidebar } from "./CollabMembersSidebar";
import { Terminal } from "@/features/terminal/Terminal";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { getGuacamoleTokenFromHost } from "@/api/guacamole-api";
import { getSSHHosts, getUserList, type SSHHostWithStatus } from "@/main-axios";
import { getRoles } from "@/api/rbac-api";
import type { Role } from "@/main-axios";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { getErrorMessage } from "@/lib/error-message";
import {
  endCollabRoom,
  dismissCollabControlRequest,
  getCollabRoom,
  getCollabStage,
  inviteCollabMembers,
  presentCollabStage,
  requestCollabStageControl,
  removeCollabMember,
  setCollabGuestLink,
  setCollabStageControl,
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
      protocol: "rdp" | "vnc" | "telnet";
      host: SSHHostWithStatus;
      token: string;
      guacamoleConnectionId: string;
    };
type PresentChoice = {
  host: SSHHostWithStatus;
  protocol: "ssh" | "rdp" | "vnc" | "telnet";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PresentDraft | null>(null);
  const [presentOpen, setPresentOpen] = useState(false);
  const [presentLoading, setPresentLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(true);
  const [endOpen, setEndOpen] = useState(false);
  const [takeoverChoice, setTakeoverChoice] = useState<PresentChoice | null>(
    null,
  );
  const [guestLinkToken, setGuestLinkToken] = useState<string | null>(null);
  const [guestLinkAction, setGuestLinkAction] = useState<
    "disable" | "rotate" | null
  >(null);
  const [hostSearch, setHostSearch] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");
  const [hosts, setHosts] = useState<SSHHostWithStatus[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; username: string }>>(
    [],
  );
  const [inviteSelection, setInviteSelection] = useState<Set<string>>(
    new Set(),
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleSelection, setRoleSelection] = useState<Set<number>>(new Set());
  const draftRef = useRef<PresentDraft | null>(null);
  draftRef.current = draft;
  const stageKeyRef = useRef<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const sequence = ++refreshSequence.current;
    try {
      const nextDetail = await getCollabRoom(roomId);
      if (sequence !== refreshSequence.current) return;
      setDetail(nextDetail);
      setLoadError(null);
      // Presenting locally? The local session is the stage - don't join it.
      if (
        nextDetail.stage.shareId &&
        nextDetail.stage.presenterUserId !== nextDetail.me
      ) {
        // A guac viewer reconnects whenever its token changes, so the stage
        // is only re-resolved when the share or my control actually changed.
        const stageKey = `${nextDetail.stage.shareId}:${
          nextDetail.controllerUserId === nextDetail.me
        }`;
        if (stageKeyRef.current !== stageKey) {
          stageKeyRef.current = stageKey;
          const { stage: resolved } = await getCollabStage(roomId);
          setStage(resolved);
        }
      } else if (!nextDetail.stage.shareId) {
        stageKeyRef.current = null;
        setStage(null);
        // The stage was cleared elsewhere; stop presenting locally too.
        if (draftRef.current) setDraft(null);
      }
    } catch (error) {
      if (sequence === refreshSequence.current) {
        setLoadError(getErrorMessage(error));
      }
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live room events. Poll only while the socket is unavailable.
  useEffect(() => {
    if (!roomId) return;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cancelled = false;

    const startPolling = () => {
      pollTimer ??= setInterval(() => void refresh(), POLL_FALLBACK_MS);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(roomEventsWsUrl());
      } catch {
        startPolling();
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }
      ws.onopen = () => {
        reconnectAttempt = 0;
        stopPolling();
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
          case "collab_control_changed":
          case "collab_control_requested":
          case "collab_control_requests_changed":
            void refresh();
            break;
          case "collab_room_ended":
            setEnded(true);
            break;
          default:
            break;
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        startPolling();
        const delay = Math.min(1000 * 2 ** reconnectAttempt++, 15000);
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (pingTimer) clearInterval(pingTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [roomId, refresh]);

  const me = detail?.me;
  const isHost = detail?.isHost ?? false;
  const controllerUserId = detail?.controllerUserId ?? null;
  const presenterUserId = detail?.stage.presenterUserId ?? null;
  const iAmPresenter = !!me && presenterUserId === me;
  const presenterName = detail?.members.find(
    (member) => member.userId === presenterUserId,
  )?.username;

  async function changeControl(targetId: string | null) {
    if (!roomId) return;
    try {
      await setCollabStageControl(roomId, targetId);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function dismissControlRequest(targetId: string) {
    if (!roomId) return;
    try {
      await dismissCollabControlRequest(roomId, targetId);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function removeMember(targetId: string) {
    if (!roomId) return;
    try {
      await removeCollabMember(roomId, targetId);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function toggleOwnControlRequest() {
    if (!roomId || !me) return;
    try {
      const existing = detail?.controlRequests.some(
        (request) => request.userId === me,
      );
      if (existing) await dismissCollabControlRequest(roomId, me);
      else await requestCollabStageControl(roomId);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function openPresentDialog() {
    setPresentOpen(true);
    if (hosts.length === 0) {
      setPresentLoading(true);
      try {
        setHosts(await getSSHHosts({ includeStatus: false }));
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setPresentLoading(false);
      }
    }
  }

  function choosePresent(
    host: SSHHostWithStatus,
    protocol: "ssh" | "rdp" | "vnc" | "telnet",
  ) {
    if (presenterUserId && !iAmPresenter) {
      setPresentOpen(false);
      setTakeoverChoice({ host, protocol });
      return;
    }
    void startPresent(host, protocol);
  }

  async function startPresent(
    host: SSHHostWithStatus,
    protocol: "ssh" | "rdp" | "vnc" | "telnet",
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
    setRoleSelection(new Set());
    try {
      const [userResult, roleResult] = await Promise.all([
        getUserList(),
        getRoles().catch(() => ({ roles: [] as Role[] })),
      ]);
      setUsers(
        userResult.users.map((user) => ({
          id: user.userId,
          username: user.username,
        })),
      );
      setRoles(roleResult.roles);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function handleGuestLink(enabled: boolean) {
    if (!roomId) return;
    try {
      const result = await setCollabGuestLink(roomId, enabled);
      setGuestLinkToken(result.guestLinkToken);
      await refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  function guestLinkUrl(token: string) {
    return `${window.location.origin}${window.location.pathname}?view=collab-guest&token=${token}`;
  }

  async function handleInvite() {
    if (!roomId || (inviteSelection.size === 0 && roleSelection.size === 0))
      return;
    try {
      await inviteCollabMembers(roomId, {
        userIds: Array.from(inviteSelection),
        roleIds: Array.from(roleSelection),
      });
      toast.success(t("collab.invited"));
      setInviteOpen(false);
      void refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  if (!roomId) {
    return (
      <div className="flex flex-1 h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Presentation className="size-8" />
          <p className="text-sm">{t("collab.reopenFromPanel")}</p>
        </div>
      </div>
    );
  }

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

  if (!detail && loadError) {
    return (
      <div className="flex flex-1 h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <AlertCircle className="size-8" />
          <p className="max-w-sm text-center text-sm">{loadError}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const memberIds = new Set(detail?.members.map((member) => member.userId));
  const normalizedInviteSearch = inviteSearch.trim().toLocaleLowerCase();
  const invitableUsers = users.filter(
    (user) =>
      !memberIds.has(user.id) &&
      user.username.toLocaleLowerCase().includes(normalizedInviteSearch),
  );
  const normalizedHostSearch = hostSearch.trim().toLocaleLowerCase();
  const filteredHosts = hosts.filter((host) =>
    host.name.toLocaleLowerCase().includes(normalizedHostSearch),
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {loadError && (
        <div
          className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs"
          role="alert"
        >
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1 truncate">{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {/* Header: room identity + primary controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-wrap">
        <Presentation className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold truncate">
          {detail?.room.name}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 shrink-0">
          {!!detail?.stage.shareId &&
            detail.stage.protocol === "ssh" &&
            !iAmPresenter &&
            !draft && (
              <Button
                size="sm"
                variant={controllerUserId === me ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() =>
                  controllerUserId === me
                    ? void changeControl(null)
                    : void toggleOwnControlRequest()
                }
              >
                <Hand className="size-3.5 mr-1" />
                {controllerUserId === me
                  ? t("collab.releaseControl")
                  : detail.controlRequests.some(
                        (request) => request.userId === me,
                      )
                    ? t("collab.cancelControlRequest")
                    : t("collab.requestControl")}
              </Button>
            )}
          {(iAmPresenter || draft || (isHost && presenterUserId)) && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => void handleStop()}
            >
              <Square className="size-3.5 mr-1" />
              {t("collab.stopPresenting")}
            </Button>
          )}
          <Button
            size="sm"
            variant={membersOpen ? "default" : "outline"}
            className="h-8 text-xs"
            aria-controls="collab-members-sidebar"
            aria-expanded={membersOpen}
            onClick={() => setMembersOpen((open) => !open)}
          >
            <Users className="mr-1 size-3.5" />
            {detail?.members.length ?? 0}
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
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
              className="h-8 text-xs"
              onClick={() => setEndOpen(true)}
            >
              {t("collab.endRoom")}
            </Button>
          )}
        </div>
      </div>

      {isHost && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
          <Link2 className="size-3.5" />
          <span className="flex-1 truncate">
            {detail?.room.guestLinkEnabled
              ? t("collab.guestLinkOn")
              : t("collab.guestLinkOff")}
          </span>
          {guestLinkToken && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => {
                void navigator.clipboard
                  .writeText(guestLinkUrl(guestLinkToken))
                  .then(() => toast.success(t("collab.linkCopied")))
                  .catch((error) => toast.error(getErrorMessage(error)));
              }}
            >
              {t("collab.copyLink")}
            </Button>
          )}
          {detail?.room.guestLinkEnabled && !guestLinkToken && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setGuestLinkAction("rotate")}
            >
              {t("collab.rotateLink")}
            </Button>
          )}
          <Button
            size="sm"
            variant={detail?.room.guestLinkEnabled ? "destructive" : "outline"}
            className="h-8 text-xs"
            onClick={() =>
              detail?.room.guestLinkEnabled
                ? setGuestLinkAction("disable")
                : void handleGuestLink(true)
            }
          >
            {t("collab.guestLink")}:{" "}
            {detail?.room.guestLinkEnabled ? "ON" : "OFF"}
          </Button>
        </div>
      )}

      <div className="relative flex flex-1 min-h-0">
        {/* Stage */}
        <div className="relative flex-1 min-w-0 min-h-0">
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
                  key={stage.connectParams.token}
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
        {membersOpen && detail && (
          <CollabMembersSidebar
            detail={detail}
            onClose={() => setMembersOpen(false)}
            onInvite={() => void openInviteDialog()}
            onControl={changeControl}
            onDismissRequest={dismissControlRequest}
            onRemoveMember={removeMember}
          />
        )}
      </div>

      {/* Present dialog */}
      <Dialog open={presentOpen} onOpenChange={setPresentOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("collab.presentTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label={t("collab.searchHosts")}
            placeholder={t("collab.searchHosts")}
            value={hostSearch}
            onChange={(event) => setHostSearch(event.target.value)}
          />
          <div className="flex flex-col gap-1">
            {presentLoading && (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!presentLoading && filteredHosts.length === 0 && (
              <CenteredNote text={t("collab.noHostsFound")} />
            )}
            {filteredHosts.map((host) => {
              const protocols: Array<"ssh" | "rdp" | "vnc" | "telnet"> = [];
              if (host.enableTerminal || host.enableSsh) protocols.push("ssh");
              if (host.enableRdp) protocols.push("rdp");
              if (host.enableVnc) protocols.push("vnc");
              if (host.enableTelnet) protocols.push("telnet");
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
                      className="h-8 text-xs uppercase"
                      onClick={() => choosePresent(host, protocol)}
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
          <Input
            aria-label={t("collab.searchUsers")}
            placeholder={t("collab.searchUsers")}
            value={inviteSearch}
            onChange={(event) => setInviteSearch(event.target.value)}
          />
          <div className="flex flex-col gap-1">
            {roles.length > 0 && (
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("collab.roles")}
              </span>
            )}
            {roles.map((role) => (
              <label
                key={role.id}
                className="flex items-center gap-2 px-2 py-1.5 text-xs border border-border cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={roleSelection.has(role.id)}
                  onChange={(e) => {
                    setRoleSelection((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(role.id);
                      else next.delete(role.id);
                      return next;
                    });
                  }}
                />
                {role.displayName || role.name}
              </label>
            ))}
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("collab.users")}
            </span>
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
              disabled={inviteSelection.size === 0 && roleSelection.size === 0}
            >
              {t("collab.invite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("collab.endConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                detail?.room.persistent
                  ? "collab.endPersistentDescription"
                  : "collab.endDescription",
                { name: detail?.room.name },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleEnd()}
            >
              {t("collab.endRoom")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(takeoverChoice)}
        onOpenChange={(open) => !open && setTakeoverChoice(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("collab.takeOverConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("collab.takeOverDescription", { name: presenterName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const choice = takeoverChoice;
                setTakeoverChoice(null);
                if (choice) void startPresent(choice.host, choice.protocol);
              }}
            >
              {t("collab.takeOver")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(guestLinkAction)}
        onOpenChange={(open) => !open && setGuestLinkAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                guestLinkAction === "rotate"
                  ? "collab.rotateLinkConfirmTitle"
                  : "collab.disableLinkConfirmTitle",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                guestLinkAction === "rotate"
                  ? "collab.rotateLinkDescription"
                  : "collab.disableLinkDescription",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const enabled = guestLinkAction === "rotate";
                setGuestLinkAction(null);
                void handleGuestLink(enabled);
              }}
            >
              {t(
                guestLinkAction === "rotate"
                  ? "collab.rotateLink"
                  : "collab.disableLink",
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
