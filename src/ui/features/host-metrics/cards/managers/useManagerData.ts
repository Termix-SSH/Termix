import { useCallback, useEffect, useState } from "react";
import { managerGet } from "@/main-axios";

interface ManagerError {
  message: string;
  code?: string;
}

function extractError(err: unknown): ManagerError {
  const e = err as {
    response?: { data?: { error?: string; code?: string } };
    message?: string;
  };
  return {
    message: e?.response?.data?.error || e?.message || "Request failed",
    code: e?.response?.data?.code,
  };
}

/**
 * Fetch a manager read resource on mount + manual refresh, with loading/error
 * state. `hostId` null disables fetching.
 */
export function useManagerData<T>(
  hostId: number | null,
  resource: string,
  params?: Record<string, string | number>,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ManagerError | null>(null);

  const paramsKey = params ? JSON.stringify(params) : "";

  const refresh = useCallback(async () => {
    if (hostId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await managerGet<T>(hostId, resource, params);
      setData(res);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, resource, paramsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh, setData };
}

export { extractError };
export type { ManagerError };
