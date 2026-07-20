import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetBoolean = vi.fn();
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockPost = vi.fn();

function makeChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "groupBy"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as unknown as Promise<unknown>).then = (
    cb: (v: unknown) => unknown,
  ) => Promise.resolve(resolveValue).then(cb);
  return chain;
}

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    getBoolean: mockGetBoolean,
    get: mockGet,
    set: mockSet,
  }),
  createCurrentRepositoryContext: () => ({
    drizzle: {
      select: vi.fn(() => makeChain([{ count: 0 }])),
    },
  }),
}));

vi.mock("../../database/db/schema.js", () => ({
  users: {},
  hosts: {},
  recentActivity: { type: "type", timestamp: "timestamp" },
}));

vi.mock("../../utils/logger.js", () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock("axios", () => ({
  default: { post: mockPost },
}));

describe("analytics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("isAnalyticsEnabled defaults to true via the settings repository", async () => {
    mockGetBoolean.mockResolvedValue(true);
    const { isAnalyticsEnabled } = await import("../../utils/analytics.js");

    const result = await isAnalyticsEnabled();

    expect(result).toBe(true);
    expect(mockGetBoolean).toHaveBeenCalledWith("analytics_enabled", true);
  });

  it("getOrCreateInstanceId returns the existing id without generating one", async () => {
    mockGet.mockResolvedValue("existing-id");
    const { getOrCreateInstanceId } = await import(
      "../../utils/analytics.js"
    );

    const id = await getOrCreateInstanceId();

    expect(id).toBe("existing-id");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("getOrCreateInstanceId generates and persists a new id when absent", async () => {
    mockGet.mockResolvedValue(null);
    const { getOrCreateInstanceId } = await import(
      "../../utils/analytics.js"
    );

    const id = await getOrCreateInstanceId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSet).toHaveBeenCalledWith("analytics_instance_id", id);
  });

  it("collectAndSendHeartbeat does not call PostHog when POSTHOG_API_KEY is unset", async () => {
    delete process.env.POSTHOG_API_KEY;
    const { collectAndSendHeartbeat } = await import(
      "../../utils/analytics.js"
    );

    await collectAndSendHeartbeat();

    expect(mockPost).not.toHaveBeenCalled();
  });

  it("collectAndSendHeartbeat does not call PostHog when analytics is disabled", async () => {
    process.env.POSTHOG_API_KEY = "phc_test";
    mockGetBoolean.mockResolvedValue(false);
    const { collectAndSendHeartbeat } = await import(
      "../../utils/analytics.js"
    );

    await collectAndSendHeartbeat();

    expect(mockPost).not.toHaveBeenCalled();
  });

  it("collectAndSendHeartbeat posts a heartbeat event with the expected shape when enabled", async () => {
    process.env.POSTHOG_API_KEY = "phc_test";
    mockGetBoolean.mockResolvedValue(true);
    mockGet.mockResolvedValue("instance-123");
    mockPost.mockResolvedValue({});
    const { collectAndSendHeartbeat } = await import(
      "../../utils/analytics.js"
    );

    await collectAndSendHeartbeat();

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toContain("/capture/");
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "instance_heartbeat",
      distinct_id: "instance-123",
      properties: expect.objectContaining({
        user_count: 0,
        host_count: 0,
        used_terminal: 0,
      }),
    });
  });
});
