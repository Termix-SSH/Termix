import { authApi, handleApiError } from "@/main-axios";

export interface AuditLog {
  id: number;
  userId: string;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  details: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  timestamp: string;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resourceType?: string;
  success?: boolean | "";
  startDate?: string;
  endDate?: string;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function mapAuditLog(row: Record<string, unknown>): AuditLog {
  return {
    id: numberValue(row.id),
    userId: stringValue(row.userId ?? row.user_id),
    username: stringValue(row.username),
    action: stringValue(row.action, "unknown"),
    resourceType: stringValue(row.resourceType ?? row.resource_type, "unknown"),
    resourceId: nullableStringValue(row.resourceId ?? row.resource_id),
    resourceName: nullableStringValue(row.resourceName ?? row.resource_name),
    details: nullableStringValue(row.details),
    ipAddress: nullableStringValue(row.ipAddress ?? row.ip_address),
    userAgent: nullableStringValue(row.userAgent ?? row.user_agent),
    success: boolValue(row.success),
    errorMessage: nullableStringValue(row.errorMessage ?? row.error_message),
    timestamp: stringValue(row.timestamp, new Date(0).toISOString()),
  };
}

export async function getAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogResponse> {
  try {
    const params = new URLSearchParams();
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.action) params.set("action", filters.action);
    if (filters.resourceType) params.set("resourceType", filters.resourceType);
    if (filters.success !== undefined && filters.success !== "")
      params.set("success", String(filters.success));
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);

    const response = await authApi.get(`/audit-logs?${params.toString()}`);
    const data = response.data as Partial<AuditLogResponse>;
    const rows = Array.isArray(data.logs) ? data.logs : [];
    return {
      logs: rows.map((row) => mapAuditLog(row as Record<string, unknown>)),
      total: numberValue(data.total),
      page: numberValue(data.page, filters.page ?? 1),
      totalPages: numberValue(data.totalPages, 1),
    };
  } catch (error) {
    handleApiError(error, "fetch audit logs");
  }
}

export async function getAuditLogActions(): Promise<{ actions: string[] }> {
  try {
    const response = await authApi.get("/audit-logs/actions");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch audit log actions");
  }
}
