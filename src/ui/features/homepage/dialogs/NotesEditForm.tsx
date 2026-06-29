import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/textarea";
import type { NotesConfig, WidgetEditFormProps } from "@/types/homepage-types";

export function NotesEditForm({
  config,
  onChange,
}: WidgetEditFormProps<NotesConfig>) {
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
          placeholder="Write your notes here..."
          className="text-sm min-h-[120px] resize-none rounded-none"
        />
      </div>
    </div>
  );
}
