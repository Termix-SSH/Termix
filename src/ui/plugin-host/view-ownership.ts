import { getPluginStoreState, type PluginRecord } from "./plugin-store";

/**
 * Who owns a tab type, rail view or dashboard card.
 *
 * Read from the manifests in GET /plugins rather than from what registered,
 * because a disabled plugin never runs its frontend and so never registers
 * anything, yet a saved tab or card of its still has to say whose it is.
 */
export type ViewKind = "tab" | "panel" | "card";

export type ViewStatus =
  /** Registered by a running plugin. */
  | "ready"
  /** Owner is enabled but its frontend has not finished loading. */
  | "loading"
  /** Owner is installed but switched off. */
  | "disabled"
  /** Owner's frontend or backend failed, or a hard dependency is missing. */
  | "failed"
  /** Nobody we know of declares this view. */
  | "missing";

function declares(record: PluginRecord, kind: ViewKind, id: string): boolean {
  const contributes = record.summary.contributes;
  if (!contributes) return false;
  if (kind === "tab") return !!contributes.tabs?.some((tab) => tab.id === id);
  if (kind === "panel") {
    return (
      !!contributes.panels?.some((panel) => panel.id === id) ||
      !!contributes.tabs?.some((tab) => tab.id === id)
    );
  }
  return !!contributes.dashboardCards?.some((card) => card.id === id);
}

export function viewOwner(
  kind: ViewKind,
  id: string,
): PluginRecord | undefined {
  for (const record of getPluginStoreState().records.values()) {
    if (declares(record, kind, id)) return record;
  }
  return undefined;
}

/** Whether a manifest declares the id, i.e. the plugin may register it. */
export function manifestDeclares(
  contributes: PluginRecord["summary"]["contributes"],
  kind: ViewKind,
  id: string,
): boolean {
  if (!contributes) return false;
  return declares(
    { summary: { contributes } as PluginRecord["summary"], frontend: "none" },
    kind,
    id,
  );
}

/**
 * Status of a view that is NOT currently registered. Callers check their
 * registry first; this explains why it is absent.
 */
export function unregisteredViewStatus(
  kind: ViewKind,
  id: string,
): { status: Exclude<ViewStatus, "ready">; owner?: PluginRecord } {
  const owner = viewOwner(kind, id);
  if (!owner) {
    return { status: getPluginStoreState().loaded ? "missing" : "loading" };
  }
  const serverState = owner.summary.state;
  if (!owner.summary.enabled) return { status: "disabled", owner };
  if (
    owner.frontend === "failed" ||
    owner.frontend === "blocked" ||
    serverState === "failed" ||
    serverState === "blocked"
  ) {
    return { status: "failed", owner };
  }
  // Running, yet it never registered this view: it declared more than it
  // ships. Nothing will arrive, so do not spin.
  if (owner.frontend === "active" || !owner.summary.frontend) {
    return { status: "missing", owner };
  }
  return { status: "loading", owner };
}
