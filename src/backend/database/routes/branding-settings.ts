import { consumeByName } from "../../plugins/registry.js";

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

interface SettingSource {
  get(key: string): Promise<string | null>;
}

export const BRANDING_PROVIDER_NAME = "brandingProvider";

/** A plugin supplies branding by providing "<its id>.brandingProvider". */
export type BrandingProvider = () =>
  Promise<BrandingSettings> | BrandingSettings;

export async function resolveBrandingSettings(
  settings: SettingSource,
): Promise<BrandingSettings> {
  const provider = consumeByName<BrandingProvider>(BRANDING_PROVIDER_NAME);
  if (provider) {
    try {
      const provided = await provider();
      return {
        appName: provided.appName?.trim() || BRANDING_DEFAULT_APP_NAME,
        tagline: provided.tagline ?? "",
        logo: provided.logo || null,
      };
    } catch {
      // A broken provider falls back to the stored settings.
    }
  }
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
