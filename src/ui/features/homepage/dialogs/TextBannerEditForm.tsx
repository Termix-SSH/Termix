import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import type {
  TextBannerConfig,
  TextBannerFontSize,
  TextBannerAlign,
  TextBannerWeight,
  WidgetEditFormProps,
} from "@/types/homepage-types";

const SIZES: { id: TextBannerFontSize; label: string }[] = [
  { id: "sm", label: "SM" },
  { id: "md", label: "MD" },
  { id: "lg", label: "LG" },
  { id: "xl", label: "XL" },
];

const ALIGNS: { id: TextBannerAlign; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Right" },
];

const WEIGHTS: { id: TextBannerWeight; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "semibold", label: "Semibold" },
  { id: "bold", label: "Bold" },
];

export function TextBannerEditForm({
  config,
  onChange,
}: WidgetEditFormProps<TextBannerConfig>) {
  const { t } = useTranslation();

  const ButtonGroup = <T extends string>({
    opts,
    value,
    onSelect,
  }: {
    opts: { id: T; label: string }[];
    value: T;
    onSelect: (v: T) => void;
  }) => (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onSelect(o.id)}
          className={`px-2 py-0.5 text-[10px] border transition-colors ${value === o.id ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.content")}
        </label>
        <Textarea
          value={config.text}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          rows={2}
          className="text-sm min-h-[60px] resize-none rounded-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.fontSize")}
        </label>
        <ButtonGroup
          opts={SIZES}
          value={config.fontSize}
          onSelect={(v) => onChange({ ...config, fontSize: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.textAlign")}
        </label>
        <ButtonGroup
          opts={ALIGNS}
          value={config.textAlign}
          onSelect={(v) => onChange({ ...config, textAlign: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.fontWeight")}
        </label>
        <ButtonGroup
          opts={WEIGHTS}
          value={config.fontWeight}
          onSelect={(v) => onChange({ ...config, fontWeight: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.backgroundColor")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.backgroundColor ?? "#1e1e2e"}
            onChange={(e) =>
              onChange({ ...config, backgroundColor: e.target.value })
            }
            className="w-8 h-8 border border-border cursor-pointer"
          />
          <Input
            value={config.backgroundColor ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                backgroundColor: e.target.value || undefined,
              })
            }
            placeholder="#1e1e2e"
            className="h-8 text-sm flex-1"
          />
          {config.backgroundColor && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...config, backgroundColor: undefined })
              }
              className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
            >
              {t("homepage.clearColor")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
