import { useEffect, type ComponentType } from "react";
import { Presentation, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCurrentUser,
  usePermission,
  type PanelProps,
  type StandaloneViewProps,
  type TabProps,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { bindApi, getSharedWithMe, listCollabRooms } from "./api";
import CollabGuestView from "./CollabGuestView";
import { CollabPanel } from "./CollabPanel";
import { CollabRoomTab } from "./CollabRoomTab";
import SharedSessionView from "./SharedSessionView";
import {
  ShareDialogHost,
  closeShareDialog,
  openShareDialog,
  type ShareTarget,
} from "./share-dialog";
import { REMOTE_DISPLAY_SLOT } from "./shared";

const COLLAB = "collab";
const SHARE_ACTION = "session-sharing.share";
const SHARED_WITH_ME_ACTION = "sessions.sharedWithMe";
const SEEN_ROOMS_KEY = "termix:collab-rooms-seen";
const INVITE_POLL_MS = 60_000;

/** `?view=shared` and `?view=collab-guest`, the two anonymous guest links. */
function GuestView({ view }: StandaloneViewProps) {
  return view === "shared" ? <SharedSessionView /> : <CollabGuestView />;
}

function CollabRoomTabView({ tab, isVisible }: TabProps) {
  const roomId = tab.data?.roomId;
  return (
    <CollabRoomTab
      roomId={typeof roomId === "string" ? roomId : undefined}
      isVisible={isVisible}
    />
  );
}

function CollabPanelView({ shell }: PanelProps) {
  return (
    <CollabPanel
      onOpenRoom={(room) =>
        shell.openTab(null, COLLAB, {
          label: room.name,
          forceNewTab: true,
          data: { roomId: room.id },
        })
      }
    />
  );
}

/**
 * Rooms are discovered by polling, so a room this browser has never shown
 * gets one toast with an Open action. The first poll after login only
 * records what already exists.
 */
function createInviteWatcher(app: TermixApp): ComponentType {
  return function InviteWatcher() {
    const user = useCurrentUser();
    const allowed = usePermission("use");
    const userId = user?.userId;

    useEffect(() => {
      if (!userId || !allowed) return;
      let cancelled = false;
      const check = async () => {
        try {
          const { rooms = [] } = await listCollabRooms();
          if (cancelled) return;
          let seen: string[] = [];
          try {
            seen = JSON.parse(localStorage.getItem(SEEN_ROOMS_KEY) ?? "[]");
          } catch {
            seen = [];
          }
          const seenSet = new Set(seen);
          const fresh = rooms.filter((room) => !seenSet.has(room.id));
          if (fresh.length === 0) return;
          localStorage.setItem(
            SEEN_ROOMS_KEY,
            JSON.stringify([...seenSet, ...fresh.map((room) => room.id)]),
          );
          if (seen.length === 0) return;
          for (const room of fresh) {
            if (room.ownerUserId === userId) continue;
            toast(app.t("collab.invitedTo", { name: room.name }), {
              action: {
                label: app.t("collab.openRoom"),
                onClick: () => app.tabs.openRailView(COLLAB),
              },
            });
          }
        } catch {
          /* next poll */
        }
      };
      void check();
      const timer = setInterval(() => void check(), INVITE_POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [userId, allowed]);

    return null;
  };
}

/** A terminal toolbar action is invoked with the terminal's slot API. */
interface TerminalSlotApi {
  getShareTarget?: () => ShareTarget | null;
}

/** A remote desktop toolbar action is invoked with the session it shows. */
interface RemoteDesktopToolbarContext {
  hostId: number;
  sessionId: string | null;
  protocol: "rdp" | "vnc" | "telnet";
  tabInstanceId?: string;
}

function isRemoteDesktopContext(
  value: unknown,
): value is RemoteDesktopToolbarContext {
  return (
    !!value &&
    typeof value === "object" &&
    "protocol" in value &&
    "hostId" in value
  );
}

export function activate(app: TermixApp): void {
  bindApi(app.api);
  app.onDispose(() => {
    closeShareDialog();
    bindApi(null);
  });

  // Rooms and share links draw remote desktop streams through this slot.
  app.declareActionSlot({ id: REMOTE_DISPLAY_SLOT, accepts: ["component"] });

  // Guest pages open the tab type's standalone view by ?view= name.
  const guestViews = {
    standalone: GuestView,
    standaloneViews: ["shared", "collab-guest"],
  };

  if (app.guest) {
    app.registerTab(COLLAB, () => null, { hostless: true, ...guestViews });
    return;
  }

  app.registerRailItem({
    id: COLLAB,
    icon: Presentation,
    titleKey: "nav.collab",
    kind: "panel",
    after: "connections",
    separatorAfter: true,
    permission: "use",
  });
  app.registerPanel(COLLAB, CollabPanelView);
  app.registerTab(COLLAB, CollabRoomTabView, {
    icon: Presentation,
    titleKey: "nav.collab",
    hostless: true,
    multiInstance: true,
    ...guestViews,
  });

  app.registerAction(
    SHARE_ACTION,
    (context: unknown) => {
      let target: ShareTarget | null = null;
      if (isRemoteDesktopContext(context)) {
        target = context.sessionId
          ? {
              hostId: context.hostId,
              sessionId: context.sessionId,
              protocol: context.protocol,
              tabInstanceId: context.tabInstanceId,
            }
          : null;
      } else {
        target = (context as TerminalSlotApi)?.getShareTarget?.() ?? null;
      }
      if (target) openShareDialog(target);
      else toast.error(app.t("sessionSharing.notReadyToShare"));
    },
    { permission: "use" },
  );
  for (const slot of ["terminal.toolbar", "remote-desktop.toolbar"]) {
    app.registerSlotContribution(slot, {
      actionId: SHARE_ACTION,
      titleKey: "sessionSharing.shareButton",
      icon: Share2,
      kind: "button",
    });
  }

  app.registerSlotContribution("shell.overlay", {
    actionId: "session-sharing.shareDialog",
    titleKey: "sessionSharing.shareButton",
    kind: "component",
    component: ShareDialogHost as ComponentType<Record<string, unknown>>,
  });
  app.registerSlotContribution("shell.overlay", {
    actionId: "session-sharing.inviteWatcher",
    titleKey: "nav.collab",
    kind: "component",
    component: createInviteWatcher(app) as ComponentType<
      Record<string, unknown>
    >,
  });

  // Core's active connections list asks for sessions shared with the user.
  app.registerAction(SHARED_WITH_ME_ACTION, () => getSharedWithMe(), {
    permission: "use",
  });
}

export function deactivate(): void {
  closeShareDialog();
}
