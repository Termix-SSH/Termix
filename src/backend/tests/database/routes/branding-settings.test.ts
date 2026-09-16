import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("../../../utils/logger.js", () => ({
  authLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const {
  BRANDING_DEFAULT_APP_NAME,
  BRANDING_LOGO_MAX_BYTES,
  parseBrandingAppName,
  parseBrandingLogoDataUrl,
  parseBrandingTagline,
  resolveBrandingSettings,
} = await import("../../../database/routes/branding-settings.js");

function settingSource(values: Record<string, string>) {
  return { get: async (key: string) => values[key] ?? null };
}

async function toDataUrl(
  buffer: Buffer,
  mime: "image/png" | "image/jpeg" | "image/webp",
): Promise<string> {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

let pngBuffer: Buffer;
let jpegBuffer: Buffer;
let webpBuffer: Buffer;
let oversizedPngBuffer: Buffer;

beforeAll(async () => {
  const image = sharp({
    create: { width: 4, height: 4, channels: 3, background: "#336699" },
  });
  pngBuffer = await image.clone().png().toBuffer();
  jpegBuffer = await image.clone().jpeg().toBuffer();
  webpBuffer = await image.clone().webp().toBuffer();
  oversizedPngBuffer = await sharp({
    create: { width: 1200, height: 1200, channels: 4, background: "#abcdef" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
});

describe("parseBrandingAppName", () => {
  it("trims and accepts a normal name", () => {
    expect(parseBrandingAppName("  My Company  ")).toBe("My Company");
  });

  it("falls back to the default when cleared", () => {
    expect(parseBrandingAppName("")).toBe(BRANDING_DEFAULT_APP_NAME);
    expect(parseBrandingAppName("   ")).toBe(BRANDING_DEFAULT_APP_NAME);
  });

  it("rejects names over 60 characters", () => {
    expect(parseBrandingAppName("x".repeat(61))).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseBrandingAppName(42)).toBeNull();
    expect(parseBrandingAppName(null)).toBeNull();
  });
});

describe("parseBrandingTagline", () => {
  it("trims and accepts a normal tagline", () => {
    expect(parseBrandingTagline("  Ship faster  ")).toBe("Ship faster");
  });

  it("accepts an empty tagline (means: use the default)", () => {
    expect(parseBrandingTagline("")).toBe("");
    expect(parseBrandingTagline("   ")).toBe("");
  });

  it("rejects taglines over 160 characters", () => {
    expect(parseBrandingTagline("x".repeat(161))).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseBrandingTagline(42)).toBeNull();
  });
});

describe("parseBrandingLogoDataUrl", () => {
  it("accepts a PNG data URL and re-encodes it to PNG", async () => {
    const result = await parseBrandingLogoDataUrl(
      await toDataUrl(pngBuffer, "image/png"),
    );
    expect(result).not.toBeNull();
    expect(result!.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = Buffer.from(result!.split(",")[1]!, "base64");
    expect(decoded.subarray(1, 4).toString()).toBe("PNG");
  });

  it("accepts a JPEG data URL and normalizes it to PNG", async () => {
    const result = await parseBrandingLogoDataUrl(
      await toDataUrl(jpegBuffer, "image/jpeg"),
    );
    expect(result).not.toBeNull();
    expect(result!.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("accepts a WEBP data URL and normalizes it to PNG", async () => {
    const result = await parseBrandingLogoDataUrl(
      await toDataUrl(webpBuffer, "image/webp"),
    );
    expect(result).not.toBeNull();
    expect(result!.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects a non-image/SVG mime prefix outright", async () => {
    const svg = Buffer.from('<svg onload="alert(1)"></svg>', "utf8").toString(
      "base64",
    );
    const result = await parseBrandingLogoDataUrl(
      `data:image/svg+xml;base64,${svg}`,
    );
    expect(result).toBeNull();
  });

  it("rejects a value that isn't a data URL at all", async () => {
    expect(await parseBrandingLogoDataUrl("not-a-data-url")).toBeNull();
    expect(await parseBrandingLogoDataUrl(undefined)).toBeNull();
  });

  it("rejects a spoofed data URL whose bytes aren't a real image", async () => {
    const fake = Buffer.from("definitely not an image").toString("base64");
    const result = await parseBrandingLogoDataUrl(
      `data:image/png;base64,${fake}`,
    );
    expect(result).toBeNull();
  });

  it("rejects an image that normalizes over the size cap", async () => {
    // Sanity check the fixture is actually large enough to exceed the cap.
    expect(oversizedPngBuffer.length).toBeGreaterThan(BRANDING_LOGO_MAX_BYTES);
    const result = await parseBrandingLogoDataUrl(
      await toDataUrl(oversizedPngBuffer, "image/png"),
    );
    expect(result).toBeNull();
  });
});

describe("resolveBrandingSettings", () => {
  it("returns built-in defaults when nothing is persisted", async () => {
    const settings = await resolveBrandingSettings(settingSource({}));
    expect(settings).toEqual({
      appName: BRANDING_DEFAULT_APP_NAME,
      tagline: "",
      logo: null,
    });
  });

  it("returns the persisted values when present", async () => {
    const settings = await resolveBrandingSettings(
      settingSource({
        branding_app_name: "Acme Ops",
        branding_tagline: "Reliable infrastructure",
        branding_logo: "data:image/png;base64,AAA=",
      }),
    );
    expect(settings).toEqual({
      appName: "Acme Ops",
      tagline: "Reliable infrastructure",
      logo: "data:image/png;base64,AAA=",
    });
  });
});
