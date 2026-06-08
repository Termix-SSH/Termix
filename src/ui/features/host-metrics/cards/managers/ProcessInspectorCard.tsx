import { useState } from "react";
import { ListTree, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface ProcessRow {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  args: string;
}

export function ProcessInspectorCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    processes: ProcessRow[];
  }>(hostId, "processes");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const procs = (data?.processes ?? []).filter(
    (p) => !filter || p.args.toLowerCase().includes(filter.toLowerCase()),
  );

  const kill = async (pid: number, signal: "TERM" | "KILL") => {
    if (hostId == null) return;
    setBusy(pid);
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "processes",
        { pid, signal },
        "signal",
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.signalSent", { pid }));
        refresh();
      } else {
        toast.error(res.output || t("hostMetrics.managers.actionFailed"));
      }
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.processInspector")}
      icon={<ListTree className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && procs.length === 0}
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("hostMetrics.managers.filter")}
        className="mb-2 h-7 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex flex-col">
        <div className="grid grid-cols-[3rem_2.5rem_2.5rem_1fr_1.5rem] gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
          <span>PID</span>
          <span>CPU</span>
          <span>MEM</span>
          <span>CMD</span>
          <span />
        </div>
        {procs.slice(0, 150).map((p) => (
          <div
            key={p.pid}
            className="grid grid-cols-[3rem_2.5rem_2.5rem_1fr_1.5rem] items-center gap-2 border-b border-border/50 py-1 font-mono text-xs last:border-0"
          >
            <span className="text-muted-foreground">{p.pid}</span>
            <span className="font-bold text-accent-brand">
              {p.cpu.toFixed(0)}%
            </span>
            <span>{p.mem.toFixed(0)}%</span>
            <span className="truncate" title={p.args}>
              {p.command}
            </span>
            <button
              onClick={() => kill(p.pid, "TERM")}
              onContextMenu={(e) => {
                e.preventDefault();
                kill(p.pid, "KILL");
              }}
              disabled={busy === p.pid}
              title={t("hostMetrics.managers.killHint")}
              className="flex size-5 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
