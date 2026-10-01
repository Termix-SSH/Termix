import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type { HostMaintenance } from "../maintenance";

export function createMaintenanceStore(api: PluginApiClient) {
  let snapshot: Record<number, HostMaintenance> = {};
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let loading = false;
  let disposed = false;
  let revision = 0;
  let error = "";
  let loaded = false;
  const emit = () => listeners.forEach((listener) => listener());
  async function refresh() {
    if (loading || disposed || document.hidden) return;
    loading = true;
    const version = revision;
    try {
      const { data } =
        await api.get<Array<{ hostId: number; state: HostMaintenance }>>(
          "/maintenance",
        );
      if (!disposed && version === revision) {
        const next = Object.fromEntries(
          data.map(({ hostId, state }) => [hostId, state]),
        );
        // Most polls change nothing; skip the emit so badges do not re-render.
        const unchanged =
          loaded && !error && JSON.stringify(next) === JSON.stringify(snapshot);
        error = "";
        loaded = true;
        if (unchanged) return;
        snapshot = next;
        emit();
      }
    } catch {
      if (!disposed && version === revision) {
        error = "maintenance.loadFailed";
        snapshot = { ...snapshot };
        emit();
      }
    } finally {
      loading = false;
    }
  }
  return {
    snapshot: () => snapshot,
    error: () => error,
    loaded: () => loaded,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!timer) {
        void refresh();
        timer = setInterval(() => void refresh(), 15_000);
        document.addEventListener("visibilitychange", refresh);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(timer);
          timer = undefined;
          document.removeEventListener("visibilitychange", refresh);
        }
      };
    },
    async edit(hostId: number, input: Record<string, unknown>) {
      const { data } = await api.post<HostMaintenance>(
        `/maintenance/${hostId}`,
        input,
      );
      revision++;
      snapshot = { ...snapshot, [hostId]: data };
      emit();
      return data;
    },
    refresh,
    dispose() {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      listeners.clear();
    },
  };
}
export type MaintenanceStore = ReturnType<typeof createMaintenanceStore>;
