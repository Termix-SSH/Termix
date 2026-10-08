import { describe, it, expect } from "vitest";
import type { Request } from "express";
import {
  detectPlatform,
  parseUserAgent,
} from "../../utils/user-agent-parser.js";

function reqWith(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe("detectPlatform", () => {
  it("detects desktop from the x-electron-app header", () => {
    expect(detectPlatform(reqWith({ "x-electron-app": "true" }))).toBe(
      "desktop",
    );
  });

  it("detects desktop from a Termix-Desktop user agent", () => {
    expect(
      detectPlatform(reqWith({ "user-agent": "Termix-Desktop/1.0 (Windows)" })),
    ).toBe("desktop");
  });

  it("detects mobile from a Termix-Mobile user agent", () => {
    expect(
      detectPlatform(reqWith({ "user-agent": "Termix-Mobile/Android 1.0" })),
    ).toBe("mobile");
  });

  it("detects mobile phones/tablets", () => {
    expect(
      detectPlatform(reqWith({ "user-agent": "Mozilla/5.0 (iPhone; ...)" })),
    ).toBe("mobile");
  });

  it("treats Android-on-desktop-OS as web", () => {
    expect(
      detectPlatform(
        reqWith({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Android" }),
      ),
    ).toBe("web");
  });

  it("defaults to web for a desktop browser", () => {
    expect(
      detectPlatform(
        reqWith({
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
        }),
      ),
    ).toBe("web");
  });
});

describe("parseUserAgent", () => {
  it("parses a Chrome-on-Windows web client", () => {
    const info = parseUserAgent(
      reqWith({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Safari/537.36",
      }),
    );
    expect(info.type).toBe("web");
    expect(info.browser).toBe("Chrome");
    expect(info.version).toBe("120.0");
    expect(info.os).toBe("Windows 10/11");
  });

  it("parses Edge distinctly from Chrome", () => {
    const info = parseUserAgent(
      reqWith({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      }),
    );
    expect(info.browser).toBe("Edge");
  });

  it("parses a Termix desktop user agent", () => {
    const info = parseUserAgent(
      reqWith({ "user-agent": "Termix-Desktop/2.3.1 (macOS; arm64)" }),
    );
    expect(info.type).toBe("desktop");
    expect(info.browser).toBe("Termix Desktop");
    expect(info.version).toBe("2.3.1");
    expect(info.os).toBe("macOS");
  });

  it("parses an iOS mobile user agent", () => {
    const info = parseUserAgent(
      reqWith({ "user-agent": "Termix-Mobile/iOS1.5 (OS 17_2)" }),
    );
    expect(info.type).toBe("mobile");
    expect(info.os).toContain("iOS");
  });
});
