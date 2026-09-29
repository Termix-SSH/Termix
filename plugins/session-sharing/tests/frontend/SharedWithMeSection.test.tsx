import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getSharedWithMe: vi.fn(async () => [] as unknown[]),
}));
const sdk = vi.hoisted(() => ({
  invokeAction: vi.fn(async () => undefined),
  allowed: true,
}));

vi.mock("../../src/frontend/api", () => api);
vi.mock("@termix/plugin-sdk/frontend", async (importActual) => ({
  ...(await importActual<typeof import("@termix/plugin-sdk/frontend")>()),
  invokeAction: sdk.invokeAction,
  usePermission: () => sdk.allowed,
  useHosts: () => ({ hosts: [], loaded: true }),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    language: "en",
  }),
}));

import { SharedWithMeSection } from "../../src/frontend/SharedWithMeSection";

function shared(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "sess-1",
    hostId: 5,
    hostName: "prod-db",
    isConnected: true,
    sharedByUsername: "alice",
    permissionLevel: "read-only",
    shareId: "share-1",
    ...overrides,
  };
}

beforeEach(() => {
  api.getSharedWithMe.mockReset();
  sdk.invokeAction.mockClear();
  sdk.allowed = true;
});

afterEach(() => cleanup());

describe("shared with me section", () => {
  it("lists sessions shared with the user", async () => {
    api.getSharedWithMe.mockResolvedValue([shared()]);
    render(<SharedWithMeSection />);

    expect(await screen.findByText("prod-db")).toBeTruthy();
    expect(
      screen.getByText('connections.sharedBy:{"username":"alice"}'),
    ).toBeTruthy();
    expect(
      screen.getByText("sessionSharing.permissionLevel.readOnly"),
    ).toBeTruthy();
  });

  it("hides a session the user already joined in a tab", async () => {
    api.getSharedWithMe.mockResolvedValue([shared()]);
    render(
      <SharedWithMeSection openTabData={[{ joinSharedSessionId: "sess-1" }]} />,
    );
    await vi.waitFor(() => expect(api.getSharedWithMe).toHaveBeenCalled());
    expect(screen.queryByText("prod-db")).toBeNull();
  });

  it("filters by the connections search", async () => {
    api.getSharedWithMe.mockResolvedValue([
      shared(),
      shared({ sessionId: "sess-2", hostName: "web", sharedByUsername: "bob" }),
    ]);
    render(<SharedWithMeSection search="bob" />);
    expect(await screen.findByText("web")).toBeTruthy();
    expect(screen.queryByText("prod-db")).toBeNull();
  });

  it("joins through the terminal's open action", async () => {
    api.getSharedWithMe.mockResolvedValue([shared()]);
    render(<SharedWithMeSection />);
    fireEvent.click(await screen.findByText("connections.join"));

    expect(sdk.invokeAction).toHaveBeenCalledWith(
      "terminal.open",
      expect.objectContaining({ id: "5", name: "prod-db" }),
      expect.objectContaining({
        joinSharedSessionId: "sess-1",
        joinShareId: "share-1",
      }),
    );
  });

  it("renders nothing for a user without the use permission", async () => {
    sdk.allowed = false;
    api.getSharedWithMe.mockResolvedValue([shared()]);
    const { container } = render(<SharedWithMeSection />);
    expect(container.textContent).toBe("");
    expect(api.getSharedWithMe).not.toHaveBeenCalled();
  });
});
