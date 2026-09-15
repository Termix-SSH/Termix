import sharp from "sharp";
import { databaseLogger } from "../../utils/logger.js";

/**
 * White-label branding: admin-configurable app name, logo and tagline shown
 * on the login screen and the browser tab. Persisted in the generic
 * key/value `settings` table -- no schema migration needed.
 */
export interface BrandingSettings {
  appName: string;
  tagline: string;
  /** PNG data URL, or null when no custom logo is configured. */
  logo: string | null;
}

export const BRANDING_KEYS = {
  appName: "branding_app_name",
  tagline: "branding_tagline",
  logo: "branding_logo",
} as const;

export const BRANDING_DEFAULT_APP_NAME = "Termix";
const APP_NAME_MAX_LENGTH = 60;
const TAGLINE_MAX_LENGTH = 160;

/**
 * Cap applies to the decoded image bytes, not the base64 text. The settings
 * table is fully cached in memory per backend process (see
 * settings-cache.ts), so an oversized logo would be permanently resident RAM
 * on every instance, not just a one-time upload cost.
 */
export const BRANDING_LOGO_MAX_BYTES = 750 * 1024;
const BRANDING_LOGO_MAX_INPUT_PIXELS = 20_000_000;

interface SettingSource {
  get(key: string): Promise<string | null>;
}

export async function resolveBrandingSettings(
  settings: SettingSource,
): Promise<BrandingSettings> {
  const [appName, tagline, logo] = await Promise.all([
    settings.get(BRANDING_KEYS.appName),
    settings.get(BRANDING_KEYS.tagline),
    settings.get(BRANDING_KEYS.logo),
  ]);

  return {
    appName: appName?.trim() || BRANDING_DEFAULT_APP_NAME,
    tagline: tagline ?? "",
    logo: logo || null,
  };
}

/** Trimmed, 1-60 chars. Falls back to the default when cleared. */
export function parseBrandingAppName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return BRANDING_DEFAULT_APP_NAME;
  if (trimmed.length > APP_NAME_MAX_LENGTH) return null;
  return trimmed;
}

/** Trimmed, 0-160 chars. An empty string means "use the built-in default". */
export function parseBrandingTagline(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > TAGLINE_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * Validates and re-encodes an uploaded logo. Only raster formats are
 * accepted (no SVG), sidestepping SVG-script XSS entirely rather than trying
 * to sanitize markup. The image is always re-encoded to PNG through sharp:
 * this both proves the payload is a genuine image (not a disguised file
 * behind a spoofed data-URL prefix) and strips any embedded metadata.
 *
 * Returns null on any validation failure; the caller is expected to reject
 * the request with a 400 without echoing back details of what was rejected.
 */
export async function parseBrandingLogoDataUrl(
  value: unknown,
): Promise<string | null> {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/]+=*)$/,
  );
  if (!match) return null;

  const [, , base64] = match;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > BRANDING_LOGO_MAX_BYTES * 4) {
    // Reject wildly oversized input before decoding it with sharp; the final
    // size check happens below on the re-encoded PNG.
    return null;
  }

  try {
    const source = sharp(buffer, {
      failOn: "error",
      limitInputPixels: BRANDING_LOGO_MAX_INPUT_PIXELS,
    });
    const metadata = await source.metadata();
    if (
      !metadata.format ||
      !["png", "jpeg", "webp"].includes(metadata.format)
    ) {
      return null;
    }
    const normalized = await source.rotate().png().toBuffer();
    if (normalized.length > BRANDING_LOGO_MAX_BYTES) return null;
    return `data:image/png;base64,${normalized.toString("base64")}`;
  } catch (err) {
    databaseLogger.warn("Rejected invalid branding logo upload", {
      operation: "branding_logo_invalid",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
