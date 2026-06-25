import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import type {
  ImageWidgetConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function ImageWidgetEditForm({
  config,
  onChange,
}: WidgetEditFormProps<ImageWidgetConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.imageUrl")}
        </label>
        <Input
          value={config.imageUrl}
          onChange={(e) => onChange({ ...config, imageUrl: e.target.value })}
          placeholder="https://example.com/image.png"
          className="h-8 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.imageLinkUrl")}
        </label>
        <Input
          value={config.linkUrl ?? ""}
          onChange={(e) =>
            onChange({ ...config, linkUrl: e.target.value || undefined })
          }
          placeholder="https://example.com"
          className="h-8 text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.imageFit")}
        </label>
        <div className="flex gap-1">
          {(["contain", "cover", "fill"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange({ ...config, fit: f })}
              className={`px-2 py-0.5 text-[10px] border transition-colors capitalize ${config.fit === f ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.altText")}
        </label>
        <Input
          value={config.alt ?? ""}
          onChange={(e) =>
            onChange({ ...config, alt: e.target.value || undefined })
          }
          placeholder={t("homepage.altTextPlaceholder")}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}
