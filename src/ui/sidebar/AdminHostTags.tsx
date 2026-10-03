import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { getHostTags, saveHostTags } from "@/api/host-tags-api";

export function AdminHostTags() {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    getHostTags()
      .then((tags) => {
        if (cancelled) return;
        setValue(tags.join("\n"));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setMessage(t("admin.hostTagsError"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const tags = await saveHostTags(
        value
          .split("\n")
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      setValue(tags.join("\n"));
      setMessage(t("admin.hostTagsSaved"));
      window.dispatchEvent(new Event("termix:host-tags-changed"));
    } catch {
      setMessage(t("admin.hostTagsError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border py-3">
      <label htmlFor="global-host-tags" className="text-xs font-medium">
        {t("admin.hostTags")}
      </label>
      <p className="text-[11px] text-muted-foreground">
        {t("admin.hostTagsDesc")}
      </p>
      <textarea
        id="global-host-tags"
        rows={5}
        disabled={!loaded || saving}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full border border-border bg-background p-2 text-xs"
      />
      <Button
        type="button"
        size="sm"
        disabled={!loaded || saving}
        onClick={() => void save()}
      >
        {t("common.save")}
      </Button>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
