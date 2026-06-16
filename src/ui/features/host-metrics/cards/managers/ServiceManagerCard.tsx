import { useMemo, useState } from "react";
import { Cog, Play, Square, RotateCw, Power } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface SystemdService {
  unit: string;
  active: string;
  sub: string;
  description: string;
}

export function ServiceManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    services: SystemdService[];
  }>(hostId, "services");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const services = useMemo(
    () =>
      (data?.services ?? []).filter(
        (s) =>
          !filter ||
          s.unit.toLowerCase().includes(filter.toLowerCase()) ||
          s.description.toLowerCase().includes(filter.toLowerCase()),
      ),
    [data?.services, filter],
  );

  const act = async (unit: string, action: string) => {
    if (hostId == null) return;
    setBusy(`${unit}:${action}`);
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "services",
        { unit, action },
        "action",
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.actionDone", { name: unit }));
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
      title={t("hostMetrics.managers.services")}
      icon={<Cog className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && services.length === 0}
    >
      <ManagerSearch
        value={filter}
        onChange={setFilter}
        count={services.length}
      />
      <div className="flex flex-col">
        {services.map((s) => (
          <div
            key={s.unit}
            className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`size-1.5 shrink-0 rounded-full ${s.active === "active" ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold" title={s.unit}>
                  {s.unit.replace(/\.service$/, "")}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {s.sub}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <ActionBtn
                onClick={() => act(s.unit, "start")}
                busy={busy === `${s.unit}:start`}
                title={t("hostMetrics.managers.start")}
              >
                <Play className="size-3" />
              </ActionBtn>
              <ActionBtn
                onClick={() => act(s.unit, "restart")}
                busy={busy === `${s.unit}:restart`}
                title={t("hostMetrics.managers.restart")}
              >
                <RotateCw className="size-3" />
              </ActionBtn>
              <ActionBtn
                onClick={() => act(s.unit, "stop")}
                busy={busy === `${s.unit}:stop`}
                title={t("hostMetrics.managers.stop")}
              >
                <Square className="size-3" />
              </ActionBtn>
              <ActionBtn
                onClick={() =>
                  act(s.unit, s.sub === "running" ? "disable" : "enable")
                }
                busy={
                  busy === `${s.unit}:enable` || busy === `${s.unit}:disable`
                }
                title={t("hostMetrics.managers.enableDisable")}
              >
                <Power className="size-3" />
              </ActionBtn>
            </div>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}

function ActionBtn({
  onClick,
  busy,
  title,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="flex size-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
