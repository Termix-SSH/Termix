import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Crown,
  Hand,
  MonitorUp,
  MousePointerClick,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
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
import type { CollabControlRequest, CollabRoomDetail } from "@/api/collab-api";

interface CollabMembersSidebarProps {
  detail: CollabRoomDetail;
  onClose: () => void;
  onInvite: () => void;
  onControl: (userId: string | null) => Promise<void>;
  onDismissRequest: (userId: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}

export function CollabMembersSidebar({
  detail,
  onClose,
  onInvite,
  onControl,
  onDismissRequest,
  onRemoveMember,
}: CollabMembersSidebarProps) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const onlineIds = new Set(detail.online.map((user) => user.userId));
  const presenterUserId = detail.stage.presenterUserId;
  const canManageControl = detail.isHost || presenterUserId === detail.me;
  const canControl =
    canManageControl &&
    detail.stage.protocol === "ssh" &&
    !!detail.stage.shareId;

  async function run(userId: string, action: () => Promise<void>) {
    setBusyUserId(userId);
    try {
      await action();
    } finally {
      setBusyUserId(null);
    }
  }

  async function grant(request: CollabControlRequest) {
    await run(request.userId, async () => {
      await onControl(request.userId);
    });
  }

  return (
    <aside
      id="collab-members-sidebar"
      aria-label={t("collab.membersPanel")}
      className="absolute inset-y-0 right-0 z-30 flex h-full w-[min(20rem,100%)] shrink-0 flex-col border-l border-border bg-background shadow-xl lg:static lg:z-auto lg:shadow-none"
    >
      <header className="flex h-11 items-center gap-2 border-b border-border px-3">
        <Users className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-semibold">
          {t("collab.membersWithCount", { count: detail.members.length })}
        </h2>
        {detail.isHost && (
          <Button size="sm" variant="outline" onClick={onInvite}>
            {t("collab.invite")}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      {canManageControl && (
        <section className="border-b border-border p-3" aria-live="polite">
          <div className="mb-2 flex items-center gap-2">
            <Hand className="size-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              {t("collab.controlQueue")}
            </h3>
            {detail.controlRequests.length > 0 && (
              <Badge variant="default" className="ml-auto text-xs">
                {detail.controlRequests.length}
              </Badge>
            )}
          </div>
          {detail.controlRequests.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("collab.noControlRequests")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {detail.controlRequests.map((request) => (
                <div
                  key={request.userId}
                  className="flex items-center gap-2 border border-border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {request.username}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(request.requestedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Button
                    size="icon-sm"
                    aria-label={t("collab.grantControlTo", {
                      name: request.username,
                    })}
                    disabled={busyUserId === request.userId}
                    onClick={() => void grant(request)}
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={t("collab.dismissControlRequest", {
                      name: request.username,
                    })}
                    disabled={busyUserId === request.userId}
                    onClick={() =>
                      void run(request.userId, () =>
                        onDismissRequest(request.userId),
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="min-h-0 flex-1 overflow-y-auto p-2">
        <h3 className="sr-only">{t("collab.members")}</h3>
        <div className="flex flex-col gap-1">
          {detail.members.map((member) => {
            const isOnline = onlineIds.has(member.userId);
            const isPresenter = member.userId === presenterUserId;
            const hasControl = member.userId === detail.controllerUserId;
            return (
              <div
                key={member.userId}
                className="group flex min-h-11 items-center gap-2 border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/40"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    isOnline ? "bg-green-500" : "bg-muted-foreground/30"
                  }`}
                  aria-label={t(isOnline ? "collab.online" : "collab.offline")}
                  role="img"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {member.username}
                    {member.userId === detail.me && (
                      <span className="ml-1 text-muted-foreground">
                        {t("collab.you")}
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {member.roomRole === "host" && (
                      <span className="flex items-center gap-1">
                        <Crown className="size-3" /> {t("collab.hostBadge")}
                      </span>
                    )}
                    {isPresenter && (
                      <span className="flex items-center gap-1">
                        <MonitorUp className="size-3" />
                        {t("collab.presenterBadge")}
                      </span>
                    )}
                    {hasControl && (
                      <span className="flex items-center gap-1">
                        <MousePointerClick className="size-3" />
                        {t("collab.controlBadge")}
                      </span>
                    )}
                  </div>
                </div>
                {canControl && !isPresenter && (
                  <Button
                    size="icon-sm"
                    variant={hasControl ? "default" : "ghost"}
                    aria-label={t(
                      hasControl
                        ? "collab.revokeControl"
                        : "collab.grantControlTo",
                      { name: member.username },
                    )}
                    disabled={busyUserId === member.userId}
                    onClick={() =>
                      void run(member.userId, () =>
                        onControl(hasControl ? null : member.userId),
                      )
                    }
                  >
                    <MousePointerClick className="size-3.5" />
                  </Button>
                )}
                {detail.isHost && member.userId !== detail.room.ownerUserId && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("collab.removeMember", {
                      name: member.username,
                    })}
                    onClick={() =>
                      setRemoving({
                        userId: member.userId,
                        username: member.username,
                      })
                    }
                  >
                    <UserMinus className="size-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("collab.removeMemberTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("collab.removeMemberDescription", {
                name: removing?.username,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing) void onRemoveMember(removing.userId);
              }}
            >
              {t("collab.deleteMember")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
