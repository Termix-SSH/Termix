import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Network } from "lucide-react";
import { AccordionSection } from "@/sidebar/AdminSettingsShared";

// Was inline in AdminGeneralSettingsSection (src/ui/sidebar/AdminSettingsSections.tsx),
// moved here into its own accordion section as part of the Tailscale plugin.
// The backing routes (GET/PATCH /users/tailscale-settings) stay in core -
// they are general user-settings infrastructure this plugin calls, not
// something it owns.

type AdminTailscaleSectionProps = {
  open: boolean;
  onToggle: () => void;
  tailscaleApiKey: string;
  setTailscaleApiKey: Dispatch<SetStateAction<string>>;
  tailscaleApiBaseUrl: string;
  setTailscaleApiBaseUrl: Dispatch<SetStateAction<string>>;
  handleSaveTailscaleApiKey: () => void;
};

export function AdminTailscaleSection({
  open,
  onToggle,
  tailscaleApiKey,
  setTailscaleApiKey,
  tailscaleApiBaseUrl,
  setTailscaleApiBaseUrl,
  handleSaveTailscaleApiKey,
}: AdminTailscaleSectionProps) {
  const { t } = useTranslation();

  return (
    <AccordionSection
      label={t("admin.sectionTailscale")}
      icon={<Network className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("admin.tailscaleApiKey")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("admin.tailscaleApiKeyDescription")}{" "}
            <a
              href="https://docs.termix.site/features/networking/tailscale"
              target="_blank"
              rel="noreferrer"
              className="text-accent-brand hover:underline"
            >
              {t("admin.tailscaleApiKeyDocsLink")}
            </a>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={tailscaleApiKey}
            onChange={(e) => setTailscaleApiKey(e.target.value)}
            placeholder="tskey-api-... / hskey-api-..."
            className="text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7 shrink-0"
            onClick={handleSaveTailscaleApiKey}
          >
            {t("common.save")}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 mt-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {t("admin.tailscaleApiBaseUrl")}
          </label>
          <span className="text-[10px] text-muted-foreground">
            {t("admin.tailscaleApiBaseUrlDescription")}
          </span>
          <Input
            value={tailscaleApiBaseUrl}
            onChange={(e) => setTailscaleApiBaseUrl(e.target.value)}
            placeholder="https://api.tailscale.com/api/v2"
            className="text-sm"
          />
        </div>
      </div>
    </AccordionSection>
  );
}
