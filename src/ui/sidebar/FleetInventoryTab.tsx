import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import {
  listFleets,
  getFleetInventory,
  refreshFleetInventory,
  type FleetRow,
  type FleetInventoryEntry,
} from "@/api/fleets-api";

type SortKey =
  | "hostName"
  | "osPrettyName"
  | "kernel"
  | "architecture"
  | "uptimeSeconds"
  | "packageManager"
  | "collectedAt";
type SortDirection = "asc" | "desc";

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDirection,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th className="px-3 py-2 text-left font-semibold">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {active ? (
          sortDirection === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

export function FleetInventoryTab({
  fleetId,
  isVisible = true,
}: {
  fleetId?: number;
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const [fleets, setFleets] = useState<FleetRow[]>([]);
  const [selectedFleetId, setSelectedFleetId] = useState<number | undefined>(
    fleetId,
  );
  const [entries, setEntries] = useState<FleetInventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("hostName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    if (fleetId !== undefined) setSelectedFleetId(fleetId);
  }, [fleetId]);

  useEffect(() => {
    listFleets()
      .then(setFleets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!fleets.length) return;
    if (selectedFleetId === undefined) {
      setSelectedFleetId(fleets[0].id);
    }
  }, [fleets, selectedFleetId]);

  const loadInventory = useCallback(async () => {
    if (selectedFleetId === undefined) return;
    setLoading(true);
    try {
      const data = await getFleetInventory(selectedFleetId);
      setEntries(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.inventoryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedFleetId, t]);

  useEffect(() => {
    if (!isVisible) return;
    loadInventory();
  }, [loadInventory, isVisible]);

  async function handleRefresh() {
    if (selectedFleetId === undefined) return;
    setRefreshing(true);
    try {
      const { results } = await refreshFleetInventory(selectedFleetId);
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0) {
        toast.warning(
          t("newUi.sidebar.fleets.commandPartialFailure", {
            failed,
            total: results.length,
          }),
        );
      } else {
        toast.success(t("newUi.sidebar.fleets.inventoryRefreshed"));
      }
      await loadInventory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.inventoryRefreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }

  function handleSort(column: SortKey) {
    if (sortKey === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column);
      setSortDirection("asc");
    }
  }

  const selectedFleet = fleets.find((f) => f.id === selectedFleetId);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = entries.filter(
      (e) =>
        !q ||
        e.hostName.toLowerCase().includes(q) ||
        (e.inventory?.osPrettyName ?? "").toLowerCase().includes(q) ||
        (e.inventory?.hostname ?? "").toLowerCase().includes(q),
    );

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "hostName":
          cmp = compareValues(a.hostName, b.hostName);
          break;
        case "osPrettyName":
          cmp = compareValues(
            a.inventory?.osPrettyName ?? null,
            b.inventory?.osPrettyName ?? null,
          );
          break;
        case "kernel":
          cmp = compareValues(
            a.inventory?.kernel ?? null,
            b.inventory?.kernel ?? null,
          );
          break;
        case "architecture":
          cmp = compareValues(
            a.inventory?.architecture ?? null,
            b.inventory?.architecture ?? null,
          );
          break;
        case "uptimeSeconds":
          cmp = compareValues(
            a.inventory?.uptimeSeconds ?? null,
            b.inventory?.uptimeSeconds ?? null,
          );
          break;
        case "packageManager":
          cmp = compareValues(
            a.inventory?.packageManager ?? null,
            b.inventory?.packageManager ?? null,
          );
          break;
        case "collectedAt":
          cmp = compareValues(
            a.inventory?.collectedAt ?? null,
            b.inventory?.collectedAt ?? null,
          );
          break;
      }
      return cmp * dir;
    });
  }, [entries, search, sortKey, sortDirection]);

  const collectedCount = entries.filter((e) => e.inventory !== null).length;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Server className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("newUi.sidebar.fleets.tabInventory")}
        </span>

        <select
          className="px-2 py-1 text-[10px] bg-background border border-border text-foreground outline-none"
          value={selectedFleetId ?? ""}
          onChange={(e) => setSelectedFleetId(Number(e.target.value))}
        >
          {fleets.map((fleet) => (
            <option key={fleet.id} value={fleet.id}>
              {fleet.name}
            </option>
          ))}
        </select>

        {selectedFleet && (
          <span className="text-[11px] text-muted-foreground">
            {t("newUi.sidebar.fleets.memberCount", {
              count: entries.length,
            })}{" "}
            &middot;{" "}
            {t("newUi.sidebar.fleets.inventoryCollectedCount", {
              count: collectedCount,
              total: entries.length,
            })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("newUi.sidebar.fleets.searchHosts")}
              className="h-7 w-48 pl-6 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing || selectedFleetId === undefined}
          >
            {refreshing ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            {t("newUi.sidebar.fleets.refreshInventory")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {loading ? (
          <div className="flex h-full items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : fleets.length === 0 ? (
          <div className="flex h-full items-center justify-center py-16 text-xs text-muted-foreground">
            {t("newUi.sidebar.fleets.noFleets")}
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="flex h-full items-center justify-center py-16 text-xs text-muted-foreground">
            {t("newUi.sidebar.fleets.noMembers")}
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryHost")}
                  column="hostName"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryOs")}
                  column="osPrettyName"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryKernel")}
                  column="kernel"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryArch")}
                  column="architecture"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryUptime")}
                  column="uptimeSeconds"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryPackageManager")}
                  column="packageManager"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortHeader
                  label={t("newUi.sidebar.fleets.inventoryCollectedAt")}
                  column="collectedAt"
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSorted.map((entry) => (
                <tr
                  key={entry.hostId}
                  className="transition-colors hover:bg-muted/40"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0",
                          entry.inventory
                            ? "bg-green-500"
                            : "bg-muted-foreground/50",
                        )}
                      />
                      <span className="min-w-0 truncate font-semibold">
                        {entry.hostName}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {entry.inventory?.osPrettyName ?? "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {entry.inventory?.kernel ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {entry.inventory?.architecture ?? "-"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatUptime(entry.inventory?.uptimeSeconds ?? null)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {entry.inventory?.packageManager ?? "-"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {entry.inventory?.collectedAt
                      ? new Date(entry.inventory.collectedAt).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
