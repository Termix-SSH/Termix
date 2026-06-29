import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import { Trash2, Plus } from "lucide-react";
import type {
  BookmarkListConfig,
  BookmarkLink,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function BookmarkListEditForm({
  config,
  onChange,
}: WidgetEditFormProps<BookmarkListConfig>) {
  const { t } = useTranslation();
  const { links } = config;

  const updateLink = (i: number, patch: Partial<BookmarkLink>) => {
    const next = links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange({ ...config, links: next });
  };

  const removeLink = (i: number) => {
    onChange({ ...config, links: links.filter((_, idx) => idx !== i) });
  };

  const addLink = () => {
    onChange({ ...config, links: [...links, { label: "", url: "" }] });
  };

  return (
    <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
      {links.map((link, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={link.label}
            onChange={(e) => updateLink(i, { label: e.target.value })}
            placeholder={t("homepage.linkLabel")}
            className="h-7 text-xs flex-1"
          />
          <Input
            value={link.url}
            onChange={(e) => updateLink(i, { url: e.target.value })}
            placeholder="https://..."
            className="h-7 text-xs flex-1"
          />
          <button
            onClick={() => removeLink(i)}
            className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={addLink}
        className="mt-1 h-7 text-xs gap-1"
      >
        <Plus size={11} /> {t("homepage.addLink")}
      </Button>
    </div>
  );
}
