import { useMemo, useState } from "react";
import { MemoryStick, Timer, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BarSeries, StatRow } from "@/components/charts";
import { useManagerData } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface MemProc {
  pid: number;
  user: string;
  mem: number;
  rss: number;
  command: string;
}
interface TimerRow {
  unit: string;
  activates: string;
  next: string;
}
interface MountUsage {
  filesystem: string;
  usePct: number;
  usedKb: number;
  sizeKb: number;
  mount: string;
}

function fmtGiB(kb: number): string {
  return `${(kb / 1024 / 1024).toFixed(1)}G`;
}

export function TopMemoryCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    processes: MemProc[];
  }>(hostId, "top-memory");
  const [query, setQuery] = useState("");
  const all = useMemo(() => data?.processes ?? [], [data?.processes]);
  const procs = useMemo(() => {
    const q = query.toLowerCase();
    return all.filter(
      (p) =>
        !q ||
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        p.user.toLowerCase().includes(q),
    );
  }, [all, query]);

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.topMemory")}
      icon={<MemoryStick className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && all.length === 0}
    >
      {all.length > 5 && (
        <ManagerSearch value={query} onChange={setQuery} count={procs.length} />
      )}
      <BarSeries
        items={procs.map((p) => ({
          label: `${p.command} (${p.pid})`,
          value: p.mem,
          valueLabel: `${p.mem.toFixed(1)}%`,
        }))}
        max={Math.max(1, ...procs.map((p) => p.mem))}
      />
    </ManagerCardShell>
  );
}

export function SystemdTimersCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    timers: TimerRow[];
  }>(hostId, "timers");
  const [query, setQuery] = useState("");
  const all = useMemo(() => data?.timers ?? [], [data?.timers]);
  const timers = useMemo(() => {
    const q = query.toLowerCase();
    return all.filter(
      (tm) =>
        !q ||
        tm.unit.toLowerCase().includes(q) ||
        tm.activates.toLowerCase().includes(q),
    );
  }, [all, query]);

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.systemdTimers")}
      icon={<Timer className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && all.length === 0}
    >
      {all.length > 5 && (
        <ManagerSearch
          value={query}
          onChange={setQuery}
          count={timers.length}
        />
      )}
      <div className="flex flex-col divide-y divide-border">
        {timers.map((tm) => (
          <StatRow
            key={tm.unit}
            label={tm.unit.replace(/\.timer$/, "")}
            value={tm.activates}
            mono
          />
        ))}
      </div>
    </ManagerCardShell>
  );
}

export function DiskBreakdownCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    mounts: MountUsage[];
  }>(hostId, "disk-breakdown");
  const [query, setQuery] = useState("");
  const all = useMemo(() => data?.mounts ?? [], [data?.mounts]);
  const mounts = useMemo(() => {
    const q = query.toLowerCase();
    return all.filter(
      (m) =>
        !q ||
        m.mount.toLowerCase().includes(q) ||
        m.filesystem.toLowerCase().includes(q),
    );
  }, [all, query]);

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.diskBreakdown")}
      icon={<HardDrive className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && all.length === 0}
    >
      {all.length > 5 && (
        <ManagerSearch
          value={query}
          onChange={setQuery}
          count={mounts.length}
        />
      )}
      <BarSeries
        items={mounts.map((m) => ({
          label: `${m.mount} (${fmtGiB(m.usedKb)}/${fmtGiB(m.sizeKb)})`,
          value: m.usePct,
          valueLabel: `${m.usePct}%`,
        }))}
        max={100}
      />
    </ManagerCardShell>
  );
}
