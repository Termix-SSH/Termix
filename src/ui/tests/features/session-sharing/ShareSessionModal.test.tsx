import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";

const api = vi.hoisted(() => ({
  createSessionShare: vi.fn(),
  getActiveSessionShares: vi.fn(async () => ({ shares: [] })),
  revokeSessionShare: vi.fn(async () => ({ success: true as const })),
}));

vi.mock("@/api/session-sharing-api", () => api);

const mainAxios = vi.hoisted(() => ({
  getUserList: vi.fn(async () => ({
    users: [
      { userId: "u1", username: "alice" },
      { userId: "u2", username: "bob" },
    ],
  })),
}));

vi.mock("@/main-axios", () => mainAxios);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

Object.assign(navigator, {
  clipboard: { writeText: vi.fn(async () => {}) },
});

import { ShareSessionModal } from "../../../features/session-sharing/ShareSessionModal";

beforeEach(() => {
  api.createSessionShare.mockReset();
  api.getActiveSessionShares.mockReset();
  api.getActiveSessionShares.mockResolvedValue({ shares: [] });
  api.revokeSessionShare.mockReset();
  mainAxios.getUserList.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ShareSessionModal", () => {
  it("creates a link share with the default read-only permission and 24h expiry", async () => {
    api.createSessionShare.mockResolvedValue({
      shareId: "share-1",
      linkToken: "tok-123",
      expiresAt: "2026-07-21T00:00:00.000Z",
    });

    render(
      <ShareSessionModal
        open={true}
        onClose={() => {}}
        hostId={42}
        sessionId="sess-1"
        protocol="ssh"
        tabInstanceId="tab-1"
      />,
    );

    const createButton = await screen.findByText(
      "sessionSharing.createLinkButton",
    );
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(api.createSessionShare).toHaveBeenCalledWith({
        hostId: 42,
        sessionId: "sess-1",
        tabInstanceId: "tab-1",
        protocol: "ssh",
        shareType: "link",
        targetUserId: undefined,
        permissionLevel: "read-only",
        expiryHours: 24,
      });
    });
  });

  it("does not submit a user share until a target user is selected", async () => {
    render(
      <ShareSessionModal
        open={true}
        onClose={() => {}}
        hostId={7}
        sessionId="sess-2"
        protocol="rdp"
      />,
    );

    fireEvent.click(await screen.findByText("sessionSharing.modeTab.user"));

    const shareButton = await screen.findByText(
      "sessionSharing.createShareButton",
    );
    expect((shareButton as HTMLButtonElement).disabled).toBe(true);
    expect(api.createSessionShare).not.toHaveBeenCalled();
  });

  it("submits a user share with the selected target and read-write permission", async () => {
    api.createSessionShare.mockResolvedValue({
      shareId: "share-2",
      linkToken: null,
      expiresAt: "2026-07-21T00:00:00.000Z",
    });

    render(
      <ShareSessionModal
        open={true}
        onClose={() => {}}
        hostId={7}
        sessionId="sess-2"
        protocol="vnc"
      />,
    );

    fireEvent.click(await screen.findByText("sessionSharing.modeTab.user"));
    fireEvent.click(await screen.findByText("alice"));

    const select = await screen.findByDisplayValue(
      "sessionSharing.permissionLevel.readOnly",
    );
    fireEvent.change(select, { target: { value: "read-write" } });

    fireEvent.click(screen.getByText("sessionSharing.createShareButton"));

    await waitFor(() => {
      expect(api.createSessionShare).toHaveBeenCalledWith({
        hostId: 7,
        sessionId: "sess-2",
        tabInstanceId: undefined,
        protocol: "vnc",
        shareType: "user",
        targetUserId: "u1",
        permissionLevel: "read-write",
        expiryHours: 24,
      });
    });
  });

  it("does not call create when there is no live session id", async () => {
    render(
      <ShareSessionModal
        open={true}
        onClose={() => {}}
        hostId={1}
        sessionId={null}
        protocol="ssh"
      />,
    );

    const createButton = await screen.findByText(
      "sessionSharing.createLinkButton",
    );
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads and renders active shares for the host", async () => {
    api.getActiveSessionShares.mockResolvedValue({
      shares: [
        {
          id: "share-x",
          hostId: 42,
          ownerUserId: "owner-1",
          protocol: "ssh",
          sessionId: "sess-1",
          tabInstanceId: null,
          shareType: "link",
          targetUserId: null,
          linkToken: "tok-abc",
          permissionLevel: "read-only",
          createdAt: "2026-07-20T00:00:00.000Z",
          expiresAt: "2026-07-21T00:00:00.000Z",
          revokedAt: null,
          lastJoinedAt: null,
          joinCount: 0,
        },
      ],
    });

    render(
      <ShareSessionModal
        open={true}
        onClose={() => {}}
        hostId={42}
        sessionId="sess-1"
        protocol="ssh"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("sessionSharing.linkShareBadge")).toBeTruthy();
    });
  });
});
