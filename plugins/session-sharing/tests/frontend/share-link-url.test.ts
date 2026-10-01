import { describe, expect, it } from "vitest";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import {
  guestViewUrl,
  sessionPublicUrl,
} from "../../src/frontend/meeting-backend";

function desktop(url: string | null): TermixApp {
  return {
    desktop: { available: true, remoteServerUrl: async () => url },
  } as unknown as TermixApp;
}

describe("session share links", () => {
  it("builds the link on the linked server for a remote session", async () => {
    const base = await sessionPublicUrl(
      desktop("https://termix.example/"),
      "remote",
    );
    expect(guestViewUrl(base, "shared", "tok")).toBe(
      "https://termix.example/?view=shared&token=tok",
    );
  });

  it("gives no link for a session on the desktop's own backend", async () => {
    expect(
      await sessionPublicUrl(desktop("https://termix.example/"), "local"),
    ).toBeNull();
    expect(
      guestViewUrl("file:///C:/app/index.html", "shared", "tok"),
    ).toBeNull();
  });

  it("uses the page address in a browser", async () => {
    const app = { desktop: { available: false } } as unknown as TermixApp;
    expect(await sessionPublicUrl(app, undefined)).toBe(window.location.href);
  });
});
