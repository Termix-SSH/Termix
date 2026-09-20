import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  remote: vi.fn(),
  stream: vi.fn(),
  poll: vi.fn(),
}));
vi.mock("@/main-axios", () => ({
  authApi: {},
  handleApiError: (error: unknown) => {
    throw error;
  },
  tunnelApi: {
    get: mocks.local,
    defaults: { baseURL: "http://localhost/ssh" },
  },
  getRemoteTunnelApi: () => ({ get: mocks.remote }),
  isElectron: () => true,
}));
vi.mock("../../api/sse-stream", () => ({
  streamServerSentEvents: mocks.stream,
}));
vi.mock("@/lib/adaptive-polling", () => ({ runAdaptivePolling: mocks.poll }));
import {
  getTunnelStatuses,
  subscribeTunnelStatuses,
} from "../../api/tunnel-api";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      invoke: vi
        .fn()
        .mockResolvedValue({ serverUrl: "https://remote.example" }),
    },
  });
});

it("keeps local connected state when a remote tunnel with the same name is disconnected", async () => {
  mocks.local.mockResolvedValue({ data: { shared: { status: "connected" } } });
  mocks.remote.mockResolvedValue({
    data: {
      shared: { status: "disconnected" },
      remoteOnly: { status: "connected" },
    },
  });
  expect(await getTunnelStatuses()).toEqual({
    shared: { status: "connected" },
    remoteOnly: { status: "connected" },
  });
});

it("keeps local state through remote polling and subsequent local SSE updates", async () => {
  let deliver: (event: { event: string; data: string }) => void = () => {};
  mocks.stream.mockImplementation((_url, _options, callback) => {
    deliver = callback;
    return new Promise(() => {});
  });
  let poll: () => Promise<boolean> = async () => false;
  mocks.poll.mockImplementation((callback) => {
    poll = callback;
    return vi.fn();
  });
  mocks.remote.mockResolvedValue({
    data: { shared: { status: "disconnected" } },
  });
  const onStatuses = vi.fn();
  const stop = subscribeTunnelStatuses(onStatuses);
  await vi.waitFor(() => expect(mocks.poll).toHaveBeenCalled());
  deliver({
    event: "statuses",
    data: JSON.stringify({ shared: { status: "connected" } }),
  });
  await poll();
  expect(onStatuses).toHaveBeenLastCalledWith({
    shared: { status: "connected" },
  });
  deliver({
    event: "statuses",
    data: JSON.stringify({ shared: { status: "disconnected" } }),
  });
  expect(onStatuses).toHaveBeenLastCalledWith({
    shared: { status: "disconnected" },
  });
  stop();
});
