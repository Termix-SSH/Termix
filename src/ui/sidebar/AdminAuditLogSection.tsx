import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  X,
} from "lucide-react";
import { AccordionSection } from "./AdminSettingsShared";
import {
  getAuditLogs,
  getAuditLogActions,
  type AuditLog,
  type AuditLogFilters,
} from "@/api/audit-log-api";
import type { AdminUser } from "./AdminManagementSections";

const RESOURCE_TYPES = [
  "user",
  "host",
  "credential",
  "snippet",
  "session",
  "api_key",
  "setting",
  "tunnel",
];

type AdminAuditLogSectionProps = {
  open: boolean;
  onToggle: () => void;
  users: AdminUser[];
};

export function AdminAuditLogSection({
  open,
  onToggle,
  users,
}: AdminAuditLogSectionProps) {
  const { t } = useTranslation();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actions, setActions] = useState<string[]>([]);

  const [filterUserId, setFilterUserId] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const [filterSuccess, setFilterSuccess] = useState<"" | "true" | "false">("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(
    async (filters: AuditLogFilters, pg: number) => {
      setLoading(true);
      try {
        const result = await getAuditLogs({ ...filters, page: pg, limit: 50 });
        setLogs(result.logs);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const buildFilters = useCallback((): AuditLogFilters => {
    const f: AuditLogFilters = {};
    if (filterUserId) f.userId = filterUserId;
    if (filterAction) f.action = filterAction;
    if (filterResourceType) f.resourceType = filterResourceType;
    if (filterSuccess !== "") f.success = filterSuccess === "true";
    if (filterStartDate) f.startDate = filterStartDate;
    if (filterEndDate) f.endDate = filterEndDate;
    return f;
  }, [
    filterUserId,
    filterAction,
    filterResourceType,
    filterSuccess,
    filterStartDate,
    filterEndDate,
  ]);

  useEffect(() => {
    if (!open) return;
    getAuditLogActions()
      .then((r) => setActions(r.actions))
      .catch(() => {});
    fetchLogs(buildFilters(), 1);
    setPage(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchLogs(buildFilters(), 1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    filterUserId,
    filterAction,
    filterResourceType,
    filterSuccess,
    filterStartDate,
    filterEndDate,
  ]);

  function clearFilters() {
    setFilterUserId("");
    setFilterAction("");
    setFilterResourceType("");
    setFilterSuccess("");
    setFilterStartDate("");
    setFilterEndDate("");
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchLogs(buildFilters(), newPage);
  }

  function formatTimestamp(ts: string) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  }

  const hasFilters =
    filterUserId ||
    filterAction ||
    filterResourceType ||
    filterSuccess !== "" ||
    filterStartDate ||
    filterEndDate;

  return (
    <AccordionSection
      label={t("admin.sectionAuditLog")}
      icon={<ClipboardList className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col pt-2 gap-2">
        {/* Filters */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterUser")}
            </label>
            <select
              className="px-2 py-1 text-[10px] bg-background border border-border text-foreground outline-none"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
            >
              <option value="">{t("admin.auditLogFilterAll")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterAction")}
            </label>
            <select
              className="px-2 py-1 text-[10px] bg-background border border-border text-foreground outline-none"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="">{t("admin.auditLogFilterAll")}</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterResourceType")}
            </label>
            <select
              className="px-2 py-1 text-[10px] bg-background border border-border text-foreground outline-none"
              value={filterResourceType}
              onChange={(e) => setFilterResourceType(e.target.value)}
            >
              <option value="">{t("admin.auditLogFilterAll")}</option>
              {RESOURCE_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterStatus")}
            </label>
            <select
              className="px-2 py-1 text-[10px] bg-background border border-border text-foreground outline-none"
              value={filterSuccess}
              onChange={(e) =>
                setFilterSuccess(e.target.value as "" | "true" | "false")
              }
            >
              <option value="">{t("admin.auditLogFilterAll")}</option>
              <option value="true">{t("admin.auditLogSuccess")}</option>
              <option value="false">{t("admin.auditLogFailed")}</option>
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterFrom")}
            </label>
            <Input
              type="datetime-local"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="text-[10px] h-7"
            />
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("admin.auditLogFilterTo")}
            </label>
            <Input
              type="datetime-local"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="text-[10px] h-7"
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-[10px] text-muted-foreground">
            {t("admin.auditLogTotal", { total })}
          </span>
          <div className="flex items-center gap-1">
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                onClick={clearFilters}
              >
                <X className="size-3" />
                {t("admin.auditLogClearFilters")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => fetchLogs(buildFilters(), page)}
              disabled={loading}
            >
              <RefreshCw
                className={`size-3 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* Log table */}
        {logs.length === 0 && !loading ? (
          <div className="py-6 text-center text-[10px] text-muted-foreground">
            {t("admin.auditLogEmpty")}
          </div>
        ) : (
          <div className="flex flex-col">
            {logs.map((log) => (
              <div
                key={log.id}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() =>
                  setExpandedId(expandedId === log.id ? null : log.id)
                }
              >
                <div className="flex items-start gap-2 py-2">
                  <span
                    className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${log.success ? "bg-green-500" : "bg-destructive"}`}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold text-foreground">
                        {log.action.replace(/_/g, " ")}
                      </span>
                      <span className="text-[9px] px-1 py-px border border-border text-muted-foreground">
                        {log.resourceType}
                      </span>
                      {log.resourceName && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                          {log.resourceName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground font-semibold">
                        {log.username}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[9px] font-semibold px-1 py-px border ${
                      log.success
                        ? "border-green-500/40 text-green-500 bg-green-500/10"
                        : "border-destructive/40 text-destructive bg-destructive/10"
                    }`}
                  >
                    {log.success
                      ? t("admin.auditLogSuccess")
                      : t("admin.auditLogFailed")}
                  </span>
                </div>

                {expandedId === log.id && (
                  <div className="ml-3.5 pb-2 flex flex-col gap-1">
                    {log.ipAddress && (
                      <span className="text-[9px] text-muted-foreground">
                        {t("admin.auditLogIp")}: {log.ipAddress}
                      </span>
                    )}
                    {log.resourceId && (
                      <span className="text-[9px] text-muted-foreground">
                        {t("admin.auditLogResourceId")}: {log.resourceId}
                      </span>
                    )}
                    {log.details && (
                      <span className="text-[9px] text-muted-foreground font-mono break-all">
                        {log.details}
                      </span>
                    )}
                    {log.errorMessage && (
                      <span className="text-[9px] text-destructive">
                        {log.errorMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={page <= 1 || loading}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="size-3" />
            </Button>
            <span className="text-[10px] text-muted-foreground">
              {t("admin.auditLogPage", { page, totalPages, total })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={page >= totalPages || loading}
              onClick={() => handlePageChange(page + 1)}
            >
              <ChevronRight className="size-3" />
            </Button>
          </div>
        )}
      </div>
    </AccordionSection>
  );
}
