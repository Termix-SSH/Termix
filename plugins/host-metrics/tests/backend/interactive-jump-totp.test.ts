import { describe, expect, it, vi } from "vitest";
import type { PluginSsh } from "@termix/plugin-sdk/backend";
import { startInteractive } from "../../src/backend/interactive.js";
import type { MetricsHost } from "../../src/backend/helpers.js";

describe("startInteractive through a jump host", () => {
  it("returns requires_totp when a jump host asks for a code", async () => {
    let answer: Promise<string | null> | null = null;
    const ssh = {
      prepare: vi.fn(async () => ({
        config: {},
        outcome: { status: "ready" },
      })),
      openTransport: vi.fn(
        (
          _host: unknown,
          _config: unknown,
          options?: {
            prompt?: { ask: (r: unknown) => Promise<string | null> };
          },
        ) => {
          answer = options!.prompt!.ask({
            kind: "totp",
            prompt: "Verification code:",
            retry: false,
          });
          return new Promise(() => {});
        },
      ),
    } as unknown as PluginSsh;
    const pending: Array<{ finish: (r: string[]) => void }> = [];
    const sessions = {
      get: () => undefined,
      addPending: (session: { finish: (r: string[]) => void }) =>
        pending.push(session),
    };
    const result = await startInteractive(
      {
        ssh,
        sessions: sessions as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
        registerViewer: vi.fn(),
      },
      {
        id: 7,
        ip: "10.0.0.1",
        port: 22,
        jumpHosts: [{ hostId: 2 }],
      } as MetricsHost,
      "u1",
    );

    expect(result.body).toMatchObject({
      requires_totp: true,
      prompt: "Verification code:",
    });
    pending[0].finish(["123456"]);
    await expect(answer).resolves.toBe("123456");
  });
});
