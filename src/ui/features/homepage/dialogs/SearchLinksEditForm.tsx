import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import type {
  SearchLinksConfig,
  SearchLinkShortcut,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function SearchLinksEditForm({
  config,
  onChange,
}: WidgetEditFormProps<SearchLinksConfig>) {
  const { t } = useTranslation();
  const { shortcuts } = config;

  const update = (i: number, patch: Partial<SearchLinkShortcut>) => {
    onChange({
      ...config,
      shortcuts: shortcuts.map((s, idx) =>
        idx === i ? { ...s, ...patch } : s,
      ),
    });
  };
  const remove = (i: number) =>
    onChange({ ...config, shortcuts: shortcuts.filter((_, idx) => idx !== i) });
  const add = () =>
    onChange({
      ...config,
      shortcuts: [...shortcuts, { label: "", queryTemplate: "" }],
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
        {shortcuts.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 border border-border/40 p-2"
          >
            <div className="flex items-center gap-1.5">
              <Input
                value={s.icon ?? ""}
                onChange={(e) =>
                  update(i, { icon: e.target.value || undefined })
                }
                placeholder="🔍"
                className="h-6 text-xs w-10 text-center"
              />
              <Input
                value={s.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={t("homepage.linkLabel")}
                className="h-6 text-xs flex-1"
              />
              <button
                onClick={() => remove(i)}
                className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <Input
              value={s.queryTemplate}
              onChange={(e) => update(i, { queryTemplate: e.target.value })}
              placeholder="https://example.com/search?q={q}"
              className="h-6 text-xs"
            />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={add}
          className="mt-1 h-7 text-xs gap-1"
        >
          <Plus size={11} /> {t("homepage.addSearchShortcut")}
        </Button>
      </div>
    </div>
  );
}
