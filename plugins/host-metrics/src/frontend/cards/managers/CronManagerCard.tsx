import { useEffect, useMemo, useState } from "react";
import { Clock4, Plus, Trash2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface CronEntry {
  raw: string;
  enabled: boolean;
  schedule: string;
  command: string;
}

export function CronManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    entries: CronEntry[];
  }>(hostId, "cron");
  const [entries, setEntries] = useState<CronEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  // Keep the real array index so edits/removes target the right entry even when
  // the list is filtered by the search box.
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return entries
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          !q ||
          entry.schedule.toLowerCase().includes(q) ||
          entry.command.toLowerCase().includes(q),
      );
  }, [entries, query]);

  useEffect(() => {
    if (data?.entries) {
      setEntries(data.entries);
      setDirty(false);
    }
  }, [data]);

  const update = (i: number, patch: Partial<CronEntry>) => {
    setEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)),
    );
    setDirty(true);
  };
  const remove = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };
  const add = () => {
    setEntries((prev) => [
      ...prev,
      { raw: "", enabled: true, schedule: "0 * * * *", command: "" },
    ]);
    setDirty(true);
  };

  const save = async () => {
    if (hostId == null) return;
    setSaving(true);
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "cron",
        { entries },
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.cronSaved"));
        setDirty(false);
        refresh();
      } else {
        toast.error(res.output || t("hostMetrics.managers.actionFailed"));
      }
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.cron")}
      icon={<Clock4 className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      headerExtra={
        <>
          <Button variant="ghost" size="xs" onClick={add}>
            <Plus className="size-3" />
          </Button>
          {dirty && (
            <Button
              variant="outline"
              size="xs"
              disabled={saving}
              onClick={save}
            >
              <Save className="size-3" />
              {t("hostMetrics.managers.save")}
            </Button>
          )}
        </>
      }
      empty={!loading && entries.length === 0}
    >
      {entries.length > 5 && (
        <ManagerSearch
          value={query}
          onChange={setQuery}
          count={visible.length}
        />
      )}
      <div className="flex flex-col gap-2">
        {visible.map(({ entry: e, index: i }) => (
          <div
            key={i}
            className="flex flex-col gap-1 border border-border bg-muted/20 p-2"
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={e.enabled}
                onChange={(ev) => update(i, { enabled: ev.target.checked })}
                className="accent-accent-brand"
                title={t("hostMetrics.managers.enabled")}
              />
              <input
                value={e.schedule}
                onChange={(ev) => update(i, { schedule: ev.target.value })}
                placeholder="0 * * * *"
                className="h-6 w-28 border border-border bg-background px-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={() => remove(i)}
                className="ml-auto text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <input
              value={e.command}
              onChange={(ev) => update(i, { command: ev.target.value })}
              placeholder={t("hostMetrics.managers.command")}
              className="h-6 w-full border border-border bg-background px-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
