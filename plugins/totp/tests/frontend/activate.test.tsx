import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import {
  isValidTotpInput,
  normalizeTotpInput,
} from "../../src/frontend/totp-input";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("registers the second factor with an enrolment section", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.secondFactors()).toEqual(["totp"]);
  });

  it("sends the typed code, backup codes included", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const verify = vi.fn(async () => {});
    rendered.renderSecondFactor("totp", { verify });
    fireEvent.change(document.getElementById("totp-code")!, {
      target: { value: "ab-cd 12 34" },
    });
    fireEvent.submit(document.getElementById("totp-code")!.closest("form")!);
    await waitFor(() =>
      expect(verify).toHaveBeenCalledWith({ totp_code: "ABCD1234" }),
    );
  });

  it("shows the enrolment state from the plugin API", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => ({ data: { enabled: true } })),
      } as never,
    });
    rendered.renderEnrollment("totp");
    expect(await screen.findByText(locales.enrollment.on)).toBeTruthy();
    expect(screen.getByText(locales.enrollment.addDevice)).toBeTruthy();
  });

  it("starts setup and shows the QR code", async () => {
    const post = vi.fn(async () => ({
      data: { secret: "JBSWY3DPEHPK3PXP", qr_code: "data:image/png;base64,x" },
    }));
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => ({ data: { enabled: false } })),
        post,
      } as never,
    });
    rendered.renderEnrollment("totp");
    fireEvent.click(await screen.findByText(locales.enrollment.enable));
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("setup", {});
  });

  it("removes the factor on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.secondFactors()).toEqual([]);
  });
});

describe("totp input", () => {
  it("normalises and validates codes", () => {
    expect(normalizeTotpInput("12 34-56")).toBe("123456");
    expect(normalizeTotpInput("abcd1234ef")).toBe("ABCD1234");
    expect(isValidTotpInput("123456")).toBe(true);
    expect(isValidTotpInput("ABCD1234")).toBe(true);
    expect(isValidTotpInput("12345")).toBe(false);
  });
});
