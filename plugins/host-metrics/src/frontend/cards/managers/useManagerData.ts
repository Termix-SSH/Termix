import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { managerGet, managerPost } from "@/main-axios";

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

interface ActionResult {
  success: boolean;
  output?: string;
}

/**
 * Run a manager POST action with consistent toast feedback (loading -> success
 * /error) and a busy flag. On success the optional `onDone` callback runs (e.g.
 * to refresh the card). Returns the result so callers can branch further.
 */
export function useManagerAction(hostId: number | null) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T extends ActionResult>(
      resource: string,
      body: unknown,
      opts: {
        action?: string;
        toastId?: string;
        loadingMsg?: string;
        successMsg?: string;
        failMsg?: string;
        onDone?: () => void;
      } = {},
    ): Promise<T | null> => {
      if (hostId == null) return null;
      const id = opts.toastId ?? `${resource}-action`;
      setBusy(true);
      if (opts.loadingMsg) toast.loading(opts.loadingMsg, { id });
      try {
        const res = await managerPost<T>(hostId, resource, body, opts.action);
        if (res.success) {
          if (opts.successMsg)
            toast.success(opts.successMsg, {
              id,
              description: res.output?.slice(-200),
            });
          else toast.dismiss(id);
          opts.onDone?.();
        } else {
          toast.error(opts.failMsg ?? res.output ?? "Action failed", {
            id,
            description: res.output?.slice(-200),
          });
        }
        return res;
      } catch (err) {
        toast.error(extractError(err).message, { id });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [hostId],
  );

  return { busy, run };
}

export { extractError };
export type { ManagerError };
