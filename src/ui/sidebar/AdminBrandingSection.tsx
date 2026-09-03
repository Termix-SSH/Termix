import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PaintbrushIcon } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { BrandingSettings } from "@/api/settings-api";
import { AccordionSection } from "./AdminSettingsShared";

const BRANDING_LOGO_MAX_BYTES = 750 * 1024;
const BRANDING_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export function AdminBrandingSection({
  open,
  onToggle,
  settings,
  setSettings,
  saving,
  onSave,
  onResetLogo,
}: {
  open: boolean;
  onToggle: () => void;
  settings: BrandingSettings | null;
  setSettings: (settings: BrandingSettings) => void;
  saving: boolean;
  onSave: () => void;
  onResetLogo: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !settings) return;
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      alert(t("admin.brandingLogoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSettings({ ...settings, logo: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <AccordionSection
      label={t("admin.sectionBranding")}
      icon={<PaintbrushIcon className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      {settings === null ? (
        <div className="pt-3 text-xs text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : (
        <div className="@container flex flex-col gap-0 pt-2">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-3 @md:grid-cols-2 border-b border-border">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.brandingAppName")}
              </span>
              <Input
                aria-label={t("admin.brandingAppName")}
                value={settings.appName}
                onChange={(event) =>
                  setSettings({ ...settings, appName: event.target.value })
                }
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.brandingAppNameDesc")}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.brandingTagline")}
              </span>
              <Input
                aria-label={t("admin.brandingTagline")}
                value={settings.tagline}
                onChange={(event) =>
                  setSettings({ ...settings, tagline: event.target.value })
                }
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.brandingTaglineDesc")}
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 py-3 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("admin.brandingLogo")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("admin.brandingLogoDesc")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {settings.logo ? (
                <img
                  src={settings.logo}
                  alt=""
                  className="size-10 object-contain border border-border bg-muted/40"
                />
              ) : (
                <div className="size-10 border border-dashed border-border" />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={BRANDING_LOGO_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("admin.brandingLogoUpload")}
              </Button>
              {settings.logo && (
                <Button size="sm" variant="outline" onClick={onResetLogo}>
                  {t("admin.brandingLogoReset")}
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-3">
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </AccordionSection>
  );
}
