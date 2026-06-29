import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import type {
  LinkTreeConfig,
  LinkTreeSection,
  LinkTreeLink,
  WidgetEditFormProps,
} from "@/types/homepage-types";

export function LinkTreeEditForm({
  config,
  onChange,
}: WidgetEditFormProps<LinkTreeConfig>) {
  const { t } = useTranslation();
  const { sections, compact } = config;

  const updateSection = (si: number, patch: Partial<LinkTreeSection>) => {
    onChange({
      ...config,
      sections: sections.map((s, i) => (i === si ? { ...s, ...patch } : s)),
    });
  };
  const removeSection = (si: number) =>
    onChange({ ...config, sections: sections.filter((_, i) => i !== si) });
  const addSection = () =>
    onChange({
      ...config,
      sections: [...sections, { heading: "", links: [] }],
    });

  const updateLink = (si: number, li: number, patch: Partial<LinkTreeLink>) => {
    const newSections = sections.map((s, i) => {
      if (i !== si) return s;
      return {
        ...s,
        links: s.links.map((l, j) => (j === li ? { ...l, ...patch } : l)),
      };
    });
    onChange({ ...config, sections: newSections });
  };
  const removeLink = (si: number, li: number) => {
    const newSections = sections.map((s, i) =>
      i !== si ? s : { ...s, links: s.links.filter((_, j) => j !== li) },
    );
    onChange({ ...config, sections: newSections });
  };
  const addLink = (si: number) => {
    const newSections = sections.map((s, i) =>
      i !== si ? s : { ...s, links: [...s.links, { label: "", url: "" }] },
    );
    onChange({ ...config, sections: newSections });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {sections.map((section, si) => (
          <div
            key={si}
            className="flex flex-col gap-1 border border-border/40 p-2"
          >
            <div className="flex items-center gap-1.5">
              <Input
                value={section.heading}
                onChange={(e) => updateSection(si, { heading: e.target.value })}
                placeholder={t("homepage.sectionHeading")}
                className="h-6 text-xs flex-1 font-semibold"
              />
              <button
                onClick={() => removeSection(si)}
                className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5 pl-2">
              {section.links.map((link, li) => (
                <div key={li} className="flex items-center gap-1">
                  <Input
                    value={link.label}
                    onChange={(e) =>
                      updateLink(si, li, { label: e.target.value })
                    }
                    placeholder={t("homepage.linkLabel")}
                    className="h-6 text-[10px] flex-1"
                  />
                  <Input
                    value={link.url}
                    onChange={(e) =>
                      updateLink(si, li, { url: e.target.value })
                    }
                    placeholder="https://..."
                    className="h-6 text-[10px] flex-1"
                  />
                  <button
                    onClick={() => removeLink(si, li)}
                    className="p-0.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addLink(si)}
                className="flex items-center gap-0.5 text-[9px] text-accent-brand hover:opacity-80 mt-0.5 self-start"
              >
                <Plus size={9} /> {t("homepage.addLink")}
              </button>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addSection}
          className="mt-1 h-7 text-xs gap-1"
        >
          <Plus size={11} /> {t("homepage.addSection")}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={compact}
          onChange={(e) => onChange({ ...config, compact: e.target.checked })}
          className="accent-accent-brand"
        />
        {t("homepage.compactMode")}
      </label>
    </div>
  );
}
