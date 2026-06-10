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
    return response.data;
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
