import type { UnavailableLook } from "@/api/look-api";
import type { PluginRecord } from "@/plugin-host/plugin-store";
import type { RegisteredLayout } from "./layout-registry";

/** Why the repair view shows instead of the chosen layout. */
export type RepairReason =
  /** ?safe-layout=1 in the address. */
  | "safe-url"
  /** TERMIX_SAFE_LAYOUT on the server. */
  | "safe-env"
  /** No installed plugin provides the layout. */
  | "missing"
  /** Its plugin is switched off. */
  | "disabled"
  /** Its plugin waits on a missing dependency or was refused. */
  | "blocked"
  /** Its plugin does not fit this Termix or plugin API. */
  | "incompatible"
  /** Its code threw while starting. */
  | "failed"
  /** It crashed while drawing, twice. */
  | "crashed";

export type LayoutStatus =
  | { kind: "ok"; layout: RegisteredLayout }
  | { kind: "loading" }
  | {
      kind: "repair";
      reason: RepairReason;
      layoutId: string;
      pluginId?: string;
      version?: string | null;
      error?: string | null;
    };

/** A crash this many times in a row hands over to the repair view. */
export const MAX_LAYOUT_CRASHES = 2;

export interface LayoutStatusInput {
  layoutId: string;
  safeFromUrl: boolean;
  safeFromEnv: boolean;
  /** The look and the plugin list have both been read. */
  ready: boolean;
  registered: RegisteredLayout | undefined;
  /** The installed plugin whose manifest declares the layout, if any. */
  owner: PluginRecord | undefined;
  /** A plugin the server skipped that declares the layout, if any. */
  unavailable: UnavailableLook | undefined;
  crashes: number;
  lastCrash: string | null;
}

/** Whether the chosen layout can be drawn, and why not when it cannot. */
export function layoutStatus(input: LayoutStatusInput): LayoutStatus {
  const repair = (
    reason: RepairReason,
    extra: { error?: string | null } = {},
  ): LayoutStatus => ({
    kind: "repair",
    reason,
    layoutId: input.layoutId,
    pluginId: input.owner?.summary.id ?? input.unavailable?.id,
    version: input.owner?.summary.version ?? input.unavailable?.version ?? null,
    error: extra.error ?? null,
  });

  if (input.safeFromUrl) return repair("safe-url");
  if (input.safeFromEnv) return repair("safe-env");
  if (input.crashes >= MAX_LAYOUT_CRASHES) {
    return repair("crashed", { error: input.lastCrash });
  }
  if (input.registered) return { kind: "ok", layout: input.registered };
  if (!input.ready) return { kind: "loading" };

  if (input.unavailable && !input.owner) {
    return repair("incompatible", { error: input.unavailable.error });
  }
  const owner = input.owner;
  if (!owner) return repair("missing");
  const summary = owner.summary;
  // Before the enabled check: the server reports a plugin that failed to
  // start as not enabled, which hid the real error behind "turned off".
  if (owner.frontend === "blocked" || summary.state === "blocked") {
    return repair("blocked", { error: owner.error ?? summary.lastError });
  }
  if (owner.frontend === "failed" || summary.state === "failed") {
    return repair("failed", { error: owner.error ?? summary.lastError });
  }
  if (!summary.enabled) return repair("disabled");
  if (owner.frontend === "loading") return { kind: "loading" };
  // Just chosen: the runtime is about to load its code.
  if (
    summary.frontend &&
    (owner.frontend === "inactive" || owner.frontend === "none")
  ) {
    return { kind: "loading" };
  }
  // Running, but it never registered the layout it declares.
  return repair("missing");
}
