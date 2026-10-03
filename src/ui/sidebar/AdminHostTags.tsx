import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { X } from "lucide-react";
import { getHostTags, saveHostTags } from "@/api/host-tags-api";

export function AdminHostTags() {
  const { t } = useTranslation();
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHostTags()
      .then((list) => {
        if (cancelled) return;
        setTags(list);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("admin.hostTagsError"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function save(next: string[]) {
    const previous = tags;
    setTags(next);
    setSaving(true);
    try {
      setTags(await saveHostTags(next));
      window.dispatchEvent(new Event("termix:host-tags-changed"));
    } catch {
      setTags(previous);
      toast.error(t("admin.hostTagsError"));
    } finally {
      setSaving(false);
    }
  }

  function add(raw: string) {
    const tag = raw.trim();
    setInput("");
    if (!tag || tags.includes(tag)) return;
    void save([...tags, tag]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="global-host-tags" className="text-xs font-medium">
        {t("admin.hostTags")}
      </label>
      <span className="text-[10px] text-muted-foreground">
        {t("admin.hostTagsDesc")}
      </span>
      <div className="flex flex-wrap items-center gap-1 min-h-9 px-2 py-1 border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted border border-border/60 text-foreground"
          >
            {tag}
            <button
              type="button"
              disabled={saving}
              aria-label={t("common.remove")}
              onClick={() => void save(tags.filter((tg) => tg !== tag))}
              className="text-muted-foreground hover:text-destructive ml-0.5"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ))}
        <input
          id="global-host-tags"
          className="flex-1 min-w-16 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
          placeholder={tags.length === 0 ? t("hosts.addTag") : ""}
          disabled={!loaded || saving}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => add(input)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if ((e.key === " " || e.key === "Enter") && input.trim()) {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && tags.length > 0) {
              void save(tags.slice(0, -1));
            }
          }}
        />
      </div>
    </div>
  );
}
