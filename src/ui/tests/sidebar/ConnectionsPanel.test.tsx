import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import type { ActiveSessionInfo } from "@/api/open-tabs-api";

const mainAxios = vi.hoisted(() => ({
  getActiveSessions: vi.fn(async () => [] as ActiveSessionInfo[]),
  deleteOpenTab: vi.fn(async () => {}),
}));

vi.mock("@/main-axios", () => mainAxios);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { ConnectionsPanel } from "../../sidebar/ConnectionsPanel";

function sharedSession(
  overrides: Partial<ActiveSessionInfo> = {},
): ActiveSessionInfo {
  return {
    sessionId: "sess-shared-1",
    hostId: 5,
    hostName: "prod-db",
    tabInstanceId: null,
    isConnected: true,
    createdAt: Date.now(),
    isOwnSession: false,
    sharedByUsername: "alice",
    permissionLevel: "read-only",
    shareId: "share-1",
    ...overrides,
  };
}

beforeEach(() => {
  mainAxios.getActiveSessions.mockReset();
  mainAxios.getActiveSessions.mockResolvedValue([]);
  mainAxios.deleteOpenTab.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ConnectionsPanel - shared with me", () => {
  it("renders a shared-with-me row for sessions the current user does not own", async () => {
    mainAxios.getActiveSessions.mockResolvedValue([sharedSession()]);

    render(
      <ConnectionsPanel
        tabs={[]}
        activeTabId=""
        allHosts={[]}
        backgroundTabRecords={[]}
        onSwitchToTab={() => {}}
        onCloseTab={() => {}}
        onReopenTab={() => {}}
        onForgetBackground={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("connections.sectionSharedWithMe")).toBeTruthy();
    });
    expect(screen.getByText("prod-db")).toBeTruthy();
    expect(
      screen.getByText('connections.sharedBy:{"username":"alice"}'),
    ).toBeTruthy();
  });

  it("does not show own sessions in the shared-with-me section", async () => {
    mainAxios.getActiveSessions.mockResolvedValue([
      sharedSession({
        isOwnSession: true,
        sharedByUsername: null,
        shareId: null,
      }),
    ]);

    render(
      <ConnectionsPanel
        tabs={[]}
        activeTabId=""
        allHosts={[]}
        backgroundTabRecords={[]}
        onSwitchToTab={() => {}}
        onCloseTab={() => {}}
        onReopenTab={() => {}}
        onForgetBackground={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mainAxios.getActiveSessions).toHaveBeenCalled();
    });
    expect(screen.queryByText("connections.sectionSharedWithMe")).toBeNull();
  });

  it("dispatches onJoinSharedSession with the session when Join is clicked", async () => {
    const session = sharedSession();
    mainAxios.getActiveSessions.mockResolvedValue([session]);
    const onJoinSharedSession = vi.fn();

    render(
      <ConnectionsPanel
        tabs={[]}
        activeTabId=""
        allHosts={[]}
        backgroundTabRecords={[]}
        onSwitchToTab={() => {}}
        onCloseTab={() => {}}
        onReopenTab={() => {}}
        onForgetBackground={() => {}}
        onJoinSharedSession={onJoinSharedSession}
      />,
    );

    const joinButton = await screen.findByText("connections.join");
    fireEvent.click(joinButton);

    expect(onJoinSharedSession).toHaveBeenCalledWith(session);
  });

  it("shows a read-write badge for read-write shared sessions", async () => {
    mainAxios.getActiveSessions.mockResolvedValue([
      sharedSession({ permissionLevel: "read-write" }),
    ]);

    render(
      <ConnectionsPanel
        tabs={[]}
        activeTabId=""
        allHosts={[]}
        backgroundTabRecords={[]}
        onSwitchToTab={() => {}}
        onCloseTab={() => {}}
        onReopenTab={() => {}}
        onForgetBackground={() => {}}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("sessionSharing.permissionLevel.readWrite"),
      ).toBeTruthy();
    });
  });
});
