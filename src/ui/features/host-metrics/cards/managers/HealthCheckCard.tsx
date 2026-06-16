import { useEffect, useMemo, useState } from "react";
import {
  HeartPulse,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Play,
  Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Sparkline } from "@/components/charts";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface HealthCheck {
  id: string;
  name: string;
  type: "tcp" | "http";
  target: string;
  port?: number;
  path?: string;
}
interface HealthResult {
  checkId: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}
interface HistoryRow {
  checkId: string;
  ts: string;
  ok: boolean;
  latencyMs: number | null;
}
interface HealthData {
  checks: HealthCheck[];
  results: HealthResult[];
  history: HistoryRow[];
}

function newCheck(): HealthCheck {
  return {
    id: `c_${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    type: "tcp",
    target: "",
    port: 80,
  };
}

export function HealthCheckCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<HealthData>(
    hostId,
    "health",
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HealthCheck[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (data?.checks && !editing) setDraft(data.checks);
  }, [data?.checks, editing]);

  const byCheck = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const h of data?.history ?? []) {
      const arr = map.get(h.checkId) ?? [];
      arr.push(h);
      map.set(h.checkId, arr);
    }
    return map;
  }, [data?.history]);

  const save = async () => {
    if (hostId == null) return;
    for (const c of draft) {
      if (!c.name.trim() || !c.target.trim()) {
        toast.error(t("hostMetrics.managers.healthMissingFields"));
        return;
      }
    }
    setSaving(true);
    try {
      const res = await managerPost<{ success: boolean }>(
        hostId,
        "health",
        { checks: draft },
        "config",
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.healthSaved"));
        setEditing(false);
        refresh();
      } else {
        toast.error(t("hostMetrics.managers.actionFailed"));
      }
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (hostId == null) return;
    setRunning(true);
    try {
      await managerPost(hostId, "health", {}, "run");
      refresh();
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setRunning(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<HealthCheck>) =>
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.healthCheck")}
      icon={<HeartPulse className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      headerExtra={
        editing ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setEditing(false);
                setDraft(data?.checks ?? []);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={saving}
              onClick={save}
            >
              {t("common.save")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={running || (data?.checks?.length ?? 0) === 0}
              onClick={runNow}
            >
              <Play className="size-3" />
              {t("hostMetrics.managers.healthRun")}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Pencil className="size-3" />
              {t("common.edit")}
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          {draft.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-1.5 border border-border bg-muted/20 p-2"
            >
              <div className="flex items-center gap-1.5">
                <input
                  value={c.name}
                  onChange={(e) => updateDraft(c.id, { name: e.target.value })}
                  placeholder={t("hostMetrics.managers.healthName")}
                  className="h-7 flex-1 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <select
                  value={c.type}
                  onChange={(e) =>
                    updateDraft(c.id, {
                      type: e.target.value as "tcp" | "http",
                    })
                  }
                  className="h-7 border border-border bg-background px-1 text-xs"
                >
                  <option value="tcp">TCP</option>
                  <option value="http">HTTP</option>
                </select>
                <button
                  onClick={() =>
                    setDraft((d) => d.filter((x) => x.id !== c.id))
                  }
                  className="flex size-7 items-center justify-center text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={c.target}
                  onChange={(e) =>
                    updateDraft(c.id, { target: e.target.value })
                  }
                  placeholder={t("hostMetrics.managers.healthTarget")}
                  className="h-7 flex-1 border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                {c.type === "tcp" ? (
                  <input
                    type="number"
                    value={c.port ?? ""}
                    onChange={(e) =>
                      updateDraft(c.id, { port: Number(e.target.value) })
                    }
                    placeholder={t("hostMetrics.ports.port")}
                    className="h-7 w-16 border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <input
                    value={c.path ?? ""}
                    onChange={(e) =>
                      updateDraft(c.id, { path: e.target.value })
                    }
                    placeholder="/health"
                    className="h-7 w-24 border border-border bg-background px-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                )}
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setDraft((d) => [...d, newCheck()])}
          >
            <Plus className="size-3" />
            {t("hostMetrics.managers.healthAddCheck")}
          </Button>
        </div>
      ) : (data?.checks?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="text-xs text-muted-foreground/60">
            {t("hostMetrics.managers.noHealthChecks")}
          </span>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Plus className="size-3" />
            {t("hostMetrics.managers.healthAddCheck")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(data?.checks ?? []).map((check) => {
            const result = data?.results?.find((r) => r.checkId === check.id);
            const hist = (byCheck.get(check.id) ?? []).slice().reverse();
            const upPct =
              hist.length > 0
                ? Math.round(
                    (hist.filter((h) => h.ok).length / hist.length) * 100,
                  )
                : null;
            return (
              <div
                key={check.id}
                className="flex flex-col gap-1 border border-border bg-muted/20 p-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {result?.ok ? (
                      <CheckCircle2 className="size-3.5 text-accent-brand" />
                    ) : (
                      <XCircle className="size-3.5 text-destructive" />
                    )}
                    <span className="text-xs font-semibold">{check.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {check.type === "tcp"
                        ? `${check.target}:${check.port}`
                        : check.target}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {result?.latencyMs != null ? `${result.latencyMs}ms` : "—"}
                    {upPct != null ? ` · ${upPct}%` : ""}
                  </span>
                </div>
                {hist.length > 1 && (
                  <Sparkline
                    data={hist.map((h) => h.latencyMs ?? 0)}
                    height={28}
                    showLastDot={false}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </ManagerCardShell>
  );
}
