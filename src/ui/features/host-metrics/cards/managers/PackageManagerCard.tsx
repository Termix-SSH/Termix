import { useMemo, useState } from "react";
import { Package, ArrowUpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface UpgradablePackage {
  name: string;
  currentVersion?: string;
  newVersion?: string;
}

export function PackageManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<{
    pkg: string | null;
    upgradable: UpgradablePackage[];
  }>(hostId, "packages");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const all = useMemo(() => data?.upgradable ?? [], [data?.upgradable]);
  const pkgs = useMemo(
    () =>
      all.filter(
        (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [all, filter],
  );

  const run = async (action: string, pkg?: string) => {
    if (hostId == null) return;
    setBusy(pkg ?? action);
    toast.loading(t("hostMetrics.managers.working"), { id: "pkg-op" });
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "packages",
        { action, pkg },
        "action",
      );
      toast[res.success ? "success" : "error"](
        res.success
          ? t("hostMetrics.managers.actionDone", { name: pkg ?? "upgrade" })
          : t("hostMetrics.managers.actionFailed"),
        { id: "pkg-op", description: res.output?.slice(-200) },
      );
      if (res.success) refresh();
    } catch (e) {
      toast.error(extractError(e).message, { id: "pkg-op" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.packages")}
      icon={<Package className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && all.length === 0}
      emptyMessage={t("hostMetrics.managers.allUpToDate")}
      headerExtra={
        all.length > 0 ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!!busy}
            onClick={() => run("upgrade-all")}
          >
            <ArrowUpCircle className="size-3" />
            {t("hostMetrics.managers.upgradeAll")}
          </Button>
        ) : undefined
      }
    >
      {all.length > 5 && (
        <ManagerSearch
          value={filter}
          onChange={setFilter}
          count={pkgs.length}
        />
      )}
      <div className="flex flex-col">
        {pkgs.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold">{p.name}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {p.currentVersion ? `${p.currentVersion} → ` : ""}
                {p.newVersion ?? ""}
              </span>
            </div>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy === p.name}
              onClick={() => run("install", p.name)}
            >
              {t("hostMetrics.managers.update")}
            </Button>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
