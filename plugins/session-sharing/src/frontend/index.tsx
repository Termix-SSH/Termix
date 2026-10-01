// The terminal surfaces need xterm's own stylesheet.
import "@xterm/xterm/css/xterm.css";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
} from "react";
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
import { bindApi } from "./api";
import { SharedWithMeSection } from "./SharedWithMeSection";
import CollabGuestView from "./CollabGuestView";
import { CollabPanel } from "./CollabPanel";
import { CollabRoomTab } from "./CollabRoomTab";
import SharedSessionView from "./SharedSessionView";
import { ParticipantsOverlay } from "./ParticipantsOverlay";
import {
  ShareDialogHost,
  bindShareApp,
  closeShareDialog,
  openShareDialog,
  type ShareTarget,
} from "./share-dialog";
import { REMOTE_DISPLAY_SLOT } from "./shared";

import { connectMeetings, type MeetingBackend } from "./meeting-backend";

let meetingApp: TermixApp;

function MeetingScope({
  children,
  serverKey,
  pin = false,
}: {
  children: (backend: MeetingBackend) => ReactNode;
  serverKey?: string;
  pin?: boolean;
}) {
  const [backend, setBackend] = useState<MeetingBackend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinned = useRef(serverKey);
  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const next = await connectMeetings(meetingApp);
        if (cancelled || request !== sequence) return;
        if (
          pin &&
          pinned.current !== undefined &&
          pinned.current !== next.key
        ) {
          setBackend(null);
          setError(meetingApp.t("collab.serverChanged"));
          return;
        }
        if (pin) pinned.current ??= next.key;
        setError(null);
        setBackend((previous) =>
          previous?.key === next.key ? previous : next,
        );
      } catch (failure) {
        if (!cancelled) {
          setBackend(null);
          setError(String(failure));
        }
      }
    };
    void refresh();
    const dispose = meetingApp.desktop.onRemoteServerChange(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [serverKey, pin]);
  if (error)
    return (
      <p role="alert" className="p-3 text-sm">
        {error}
      </p>
    );
  return backend ? (
    <div key={backend.key} className="contents">
      {children(backend)}
    </div>
  ) : null;
}

const COLLAB = "collab";
const SHARE_ACTION = "session-sharing.share";
const SEEN_ROOMS_KEY = "termix:collab-rooms-seen";
const INVITE_POLL_MS = 60_000;

/** `?view=shared` and `?view=collab-guest`, the two anonymous guest links. */
function GuestView({ view }: StandaloneViewProps) {
  return view === "shared" ? <SharedSessionView /> : <CollabGuestView />;
}

function CollabRoomTabView({ tab, isVisible }: TabProps) {
  const roomId = tab.data?.roomId;
  const serverKey =
    typeof tab.data?.meetingServerKey === "string"
      ? tab.data.meetingServerKey
      : undefined;
  return (
    <MeetingScope serverKey={serverKey} pin>
      {(backend) => (
        <CollabRoomTab
          roomId={typeof roomId === "string" ? roomId : undefined}
          isVisible={isVisible}
          backend={backend}
        />
      )}
    </MeetingScope>
  );
}

function CollabPanelView({ shell }: PanelProps) {
  return (
    <MeetingScope>
      {(backend) => (
        <CollabPanel
          backend={backend}
          onOpenRoom={(room) =>
            shell.openTab(null, COLLAB, {
              label: room.name,
              forceNewTab: true,
              data: { roomId: room.id, meetingServerKey: backend.key },
            })
          }
        />
      )}
    </MeetingScope>
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
          const { rooms = [] } = await (
            await connectMeetings(app)
          ).api.listCollabRooms();
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
  origin?: "local" | "remote";
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
  meetingApp = app;
  bindApi(app.api, app.apiFor);
  bindShareApp(app);
  app.onDispose(() => {
    closeShareDialog();
    bindApi(null);
    bindShareApp(null);
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
              origin: context.origin,
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

  // The tab bar's right-click menu, for a terminal whose toolbar is hidden.
  app.registerSlotContribution("tab.menu", {
    actionId: SHARE_ACTION,
    titleKey: "sessionSharing.shareButton",
    icon: Share2,
    kind: "button",
    when: (context) => {
      const handle = context.handle as
        { getShareTarget?: () => unknown } | null | undefined;
      return typeof handle?.getShareTarget === "function"
        ? handle.getShareTarget() !== null
        : false;
    },
  });

  // A small share button on the tab itself, as in 2.8.
  app.registerSlotContribution("tab.inline", {
    actionId: SHARE_ACTION,
    titleKey: "sessionSharing.shareButton",
    icon: Share2,
    kind: "button",
    when: (context) =>
      typeof (context.handle as { getShareTarget?: unknown } | null | undefined)
        ?.getShareTarget === "function",
  });

  app.registerSlotContribution("terminal.overlay", {
    actionId: "session-sharing.participants",
    titleKey: "collab.members",
    kind: "component",
    component: ParticipantsOverlay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

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

  // The "Shared with me" section of the active connections list.
  app.registerSlotContribution("connections.sections", {
    actionId: "session-sharing.sharedWithMe",
    titleKey: "connections.sectionSharedWithMe",
    kind: "component",
    component: SharedWithMeSection as ComponentType<Record<string, unknown>>,
  });
}

export function deactivate(): void {
  closeShareDialog();
}
