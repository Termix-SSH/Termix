import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import type {
  MarkdownNotesConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function MarkdownNotesEditForm({
  config,
  onChange,
}: WidgetEditFormProps<MarkdownNotesConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.content")}
        </label>
        <Textarea
          value={config.content}
          onChange={(e) => onChange({ ...config, content: e.target.value })}
          className="text-sm min-h-[120px] resize-none rounded-none font-mono"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.renderMarkdown}
          onChange={(e) =>
            onChange({ ...config, renderMarkdown: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.renderMarkdown")}
      </label>
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
