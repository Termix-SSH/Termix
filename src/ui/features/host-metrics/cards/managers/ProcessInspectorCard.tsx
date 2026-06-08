import { useMemo, useState } from "react";
import { ListTree, X, Skull } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface ProcessRow {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  args: string;
}

type SortKey = "cpu" | "mem" | "pid";
type Signal = "TERM" | "KILL";

export function ProcessInspectorCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    processes: ProcessRow[];
  }>(hostId, "processes");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("cpu");
  const [tree, setTree] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const all = useMemo(() => data?.processes ?? [], [data?.processes]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const list = all.filter(
      (p) =>
        !q ||
        p.args.toLowerCase().includes(q) ||
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        p.user.toLowerCase().includes(q),
    );
    return [...list].sort((a, b) => {
      if (sort === "pid") return a.pid - b.pid;
      return b[sort] - a[sort];
    });
  }, [all, filter, sort]);

  // Build a depth map for the tree view from ppid links (only among visible).
  const treeRows = useMemo(() => {
    if (!tree) return null;
    const byId = new Map(filtered.map((p) => [p.pid, p]));
    const children = new Map<number, ProcessRow[]>();
    const roots: ProcessRow[] = [];
    for (const p of filtered) {
      if (p.ppid && byId.has(p.ppid)) {
        const arr = children.get(p.ppid) ?? [];
        arr.push(p);
        children.set(p.ppid, arr);
      } else {
        roots.push(p);
      }
    }
    const out: Array<{ proc: ProcessRow; depth: number }> = [];
    const walk = (p: ProcessRow, depth: number) => {
      out.push({ proc: p, depth });
      for (const c of children.get(p.pid) ?? []) walk(c, depth + 1);
    };
    roots.forEach((r) => walk(r, 0));
    return out;
  }, [tree, filtered]);

  const kill = async (pid: number, signal: Signal) => {
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

  const rows = treeRows
    ? treeRows.slice(0, 200)
    : filtered.slice(0, 200).map((proc) => ({ proc, depth: 0 }));

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.processInspector")}
      icon={<ListTree className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && filtered.length === 0}
      headerExtra={
        <>
          <button
            onClick={() => setTree((v) => !v)}
            className={`flex h-6 items-center gap-1 border px-1.5 text-[10px] transition-colors ${
              tree
                ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListTree className="size-3" />
            {t("hostMetrics.managers.tree")}
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            disabled={tree}
            className="h-6 border border-border bg-background px-1 text-[10px] disabled:opacity-40"
          >
            <option value="cpu">CPU</option>
            <option value="mem">MEM</option>
            <option value="pid">PID</option>
          </select>
        </>
      }
    >
      <ManagerSearch
        value={filter}
        onChange={setFilter}
        count={filtered.length}
      />
      <div className="flex flex-col">
        <div className="grid grid-cols-[3rem_2.5rem_2.5rem_1fr_1.5rem] gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
          <span>PID</span>
          <span>CPU</span>
          <span>MEM</span>
          <span>CMD</span>
          <span />
        </div>
        {rows.map(({ proc: p, depth }) => (
          <div
            key={p.pid}
            className="relative grid grid-cols-[3rem_2.5rem_2.5rem_1fr_1.5rem] items-center gap-2 border-b border-border/50 py-1 font-mono text-xs last:border-0"
          >
            <span className="text-muted-foreground">{p.pid}</span>
            <span className="font-bold text-accent-brand">
              {p.cpu.toFixed(0)}%
            </span>
            <span>{p.mem.toFixed(0)}%</span>
            <span
              className="truncate"
              title={`${p.user} · ${p.args}`}
              style={depth ? { paddingLeft: depth * 12 } : undefined}
            >
              {depth > 0 && (
                <span className="text-muted-foreground/40">└ </span>
              )}
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
              {busy === p.pid ? (
                <Skull className="size-3" />
              ) : (
                <X className="size-3" />
              )}
            </button>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
