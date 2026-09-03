/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getBranding, type BrandingSettings } from "@/api/settings-api";

const DEFAULT_APP_NAME = "Termix";

interface BrandingContextValue {
  ready: boolean;
  appName: string;
  tagline: string;
  logo: string | null;
  /** Re-applies a freshly saved BrandingSettings without a page reload. */
  applyBranding: (settings: BrandingSettings) => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  ready: false,
  appName: DEFAULT_APP_NAME,
  tagline: "",
  logo: null,
  applyBranding: () => {},
});

const ICON_SELECTORS = ['link[rel="icon"]', 'link[rel="apple-touch-icon"]'];

// Captured once at module load, before any branding is ever applied, so a
// cleared/reset logo can restore the bundled default rather than leaving the
// last custom icon in place until a full page reload.
const DEFAULT_ICON_HREFS: Partial<Record<string, string>> = {};
for (const selector of ICON_SELECTORS) {
  const link = document.querySelector<HTMLLinkElement>(selector);
  if (link) DEFAULT_ICON_HREFS[selector] = link.href;
}

function applyDocumentBranding(settings: BrandingSettings): void {
  document.title = settings.appName;
  for (const selector of ICON_SELECTORS) {
    const link = document.querySelector<HTMLLinkElement>(selector);
    if (!link) continue;
    link.href = settings.logo ?? DEFAULT_ICON_HREFS[selector] ?? link.href;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [branding, setBranding] = useState<BrandingSettings>({
    appName: DEFAULT_APP_NAME,
    tagline: "",
    logo: null,
  });

  useEffect(() => {
    let cancelled = false;
    getBranding()
      .then((settings) => {
        if (cancelled) return;
        setBranding(settings);
        applyDocumentBranding(settings);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBranding = useCallback((settings: BrandingSettings) => {
    setBranding(settings);
    applyDocumentBranding(settings);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      appName: branding.appName,
      tagline: branding.tagline,
      logo: branding.logo,
      applyBranding,
    }),
    [ready, branding, applyBranding],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
