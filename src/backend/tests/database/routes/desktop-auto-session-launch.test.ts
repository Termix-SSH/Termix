import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  desktopAutoSessionRefusal,
  setLaunchSecretForTests,
} from "../../../database/routes/desktop-auto-session.js";

const SECRET = "a".repeat(64);

function req(headers: Record<string, string>): Request {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

const APP = { "x-electron-app": "true", origin: "app://termix" };

beforeEach(() => {
  vi.stubEnv("ELECTRON_EMBEDDED", "true");
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  setLaunchSecretForTests("");
  vi.unstubAllEnvs();
});

describe("desktop auto session launch secret", () => {
  it("refuses a local program that knows the header but not this launch's secret", () => {
    setLaunchSecretForTests(SECRET);
    expect(desktopAutoSessionRefusal(req(APP))).toBe("launch secret");
    expect(
      desktopAutoSessionRefusal(
        req({ ...APP, "x-termix-launch": "b".repeat(64) }),
      ),
    ).toBe("launch secret");
    expect(
      desktopAutoSessionRefusal(req({ ...APP, "x-termix-launch": "short" })),
    ).toBe("launch secret");
  });

  it("lets the app in with its secret", () => {
    setLaunchSecretForTests(SECRET);
    expect(
      desktopAutoSessionRefusal(req({ ...APP, "x-termix-launch": SECRET })),
    ).toBeNull();
  });

  it("keeps working for a dev backend that was given no secret", () => {
    expect(desktopAutoSessionRefusal(req(APP))).toBeNull();
  });
});
