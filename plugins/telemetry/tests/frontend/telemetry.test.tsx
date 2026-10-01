import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginApiClient, TermixApp } from "@termix/plugin-sdk/frontend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import {
  countTabTypes,
  openedSince,
  startTabTracker,
} from "../../src/frontend/tracker";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@termix/plugin-sdk/frontend")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
  }),
  usePluginApi: () => api,
}));

const { TelemetryStatusSetting } =
  await import("../../src/frontend/TelemetryStatusSetting");

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
  api.get.mockReset();
  api.post.mockReset();
  vi.useRealTimers();
});

function fakeApp(track: boolean) {
  let layout: unknown = { version: 1, tabs: [] };
  let onChange: () => void = () => undefined;
  const posts: unknown[] = [];
  const app = {
    api: {
      get: vi.fn(async () => ({ data: { track } })),
    },
    fetch: vi.fn(async (_path: string, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }),
    tabs: {
      getLayout: () => layout,
      onReady: (listener: () => void) => {
        listener();
        return () => undefined;
      },
      onChange: (listener: () => void) => {
        onChange = listener;
        return () => undefined;
      },
    },
    onSettingsChanged: () => () => undefined,
  } as unknown as TermixApp;
  return {
    app,
    posts,
    setTabs(types: string[]) {
      layout = { version: 1, tabs: types.map((type) => ({ type })) };
      onChange();
    },
  };
}

describe("tab counting", () => {
  it("counts tabs per type and the ones opened since", () => {
    const before = countTabTypes({
      tabs: [{ type: "terminal" }, { type: "terminal" }, { type: "docker" }],
    });
    expect(before).toEqual({ terminal: 2, docker: 1 });
    expect(countTabTypes(null)).toEqual({});
    expect(
      openedSince(before, { terminal: 3, docker: 0, "file-manager": 1 }),
    ).toEqual({ "tab.terminal": 1, "tab.file-manager": 1 });
  });
});

describe("startTabTracker", () => {
  it("sends newly opened tabs on the timer", async () => {
    vi.useFakeTimers();
    const fake = fakeApp(true);
    const stop = startTabTracker(fake.app, 1000);
    await vi.waitFor(() => expect(fake.app.api.get).toHaveBeenCalled());
    await Promise.resolve();

    fake.setTabs(["terminal"]);
    fake.setTabs(["terminal", "terminal", "docker"]);
    fake.setTabs(["docker"]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.posts).toEqual([
      { features: { "tab.terminal": 2, "tab.docker": 1 } },
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.posts).toHaveLength(1);
    stop();
  });

  it("sends nothing for a user who is not counted", async () => {
    vi.useFakeTimers();
    const fake = fakeApp(false);
    const stop = startTabTracker(fake.app, 1000);
    await vi.waitFor(() => expect(fake.app.api.get).toHaveBeenCalled());
    fake.setTabs(["terminal"]);
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect(fake.posts).toEqual([]);
  });
});

describe("telemetry activate", () => {
  it("registers the status component and removes it on deactivate", async () => {
    api.get.mockResolvedValue({ data: { track: false } });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
    });
    expect(rendered.registered.settingsComponents()).toEqual(["status"]);
    await rendered.deactivate();
    expect(rendered.registered.settingsComponents()).toEqual([]);
    rendered = null;
  });
});

describe("TelemetryStatusSetting", () => {
  const props = {
    pluginId: "telemetry",
    values: {},
    setValue: () => undefined,
    running: true,
  };

  it("shows the state, instance id and last error", async () => {
    api.get.mockResolvedValue({
      data: {
        enabled: true,
        locked: false,
        instanceId: "abc-123",
        lastSentAt: null,
        lastAttemptAt: "2026-09-30T00:00:00.000Z",
        lastError: "PostHog answered 500",
        nextDueAt: null,
      },
    });
    render(<TelemetryStatusSetting {...props} />);
    await waitFor(() => expect(screen.getByText("status.on")).toBeTruthy());
    expect(screen.getByText("status.instanceId abc-123")).toBeTruthy();
    expect(screen.getByText("status.neverSent")).toBeTruthy();
    expect(
      screen.getByText("status.lastError PostHog answered 500"),
    ).toBeTruthy();
  });

  it("says when ENABLE_TELEMETRY locks it off", async () => {
    api.get.mockResolvedValue({
      data: {
        enabled: false,
        locked: true,
        instanceId: null,
        lastSentAt: null,
        lastAttemptAt: null,
        lastError: null,
        nextDueAt: null,
      },
    });
    render(<TelemetryStatusSetting {...props} />);
    await waitFor(() =>
      expect(screen.getByText("status.lockedOff")).toBeTruthy(),
    );
    expect(
      (screen.getByText("status.sendNow") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
