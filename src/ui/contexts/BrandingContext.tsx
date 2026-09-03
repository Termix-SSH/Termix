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

function applyDocumentBranding(settings: BrandingSettings): void {
  document.title = settings.appName;
  if (!settings.logo) return;
  const iconSelectors = ['link[rel="icon"]', 'link[rel="apple-touch-icon"]'];
  for (const selector of iconSelectors) {
    const link = document.querySelector<HTMLLinkElement>(selector);
    if (link) link.href = settings.logo;
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
