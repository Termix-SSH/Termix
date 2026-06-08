import { MemoryStick, Timer, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BarSeries, StatRow } from "@/components/charts";
import { useManagerData } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

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
  const procs = data?.processes ?? [];
  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.topMemory")}
      icon={<MemoryStick className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && procs.length === 0}
    >
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
  const timers = data?.timers ?? [];
  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.systemdTimers")}
      icon={<Timer className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && timers.length === 0}
    >
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
  const mounts = data?.mounts ?? [];
  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.diskBreakdown")}
      icon={<HardDrive className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && mounts.length === 0}
    >
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
