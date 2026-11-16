import { useMemo, useSyncExternalStore } from "react";
import {
  getSlotContributions,
  subscribeToActionRegistry,
  getActionPermission,
  type SlotContribution,
} from "@/shell/action-registry";
import { usePermissions } from "@/hooks/use-permissions";
import { getForeignRuntime } from "@/components/foreign/foreign-runtime";

/**
 * The contributions in a slot that the current user may actually see.
 *
 * A slot owner calls this without knowing which plugins contributed, or
 * whether any did. Contributions the user lacks the permission for are
 * dropped entirely rather than disabled, which is how admin-gated UI already
 * behaves elsewhere in the app.
 */
export function useActionSlot(
  slotId: string,
  context?: Record<string, unknown>,
): SlotContribution[] {
  // Inside a plugin frame the shell filters and sends the list. The runtime
  // is set once before anything renders, so the source never switches.
  const runtime = getForeignRuntime();
  const useSource = runtime
    ? runtime.withOwn
      ? useOwnAndForeignSlot
      : runtime.useSlot
    : usePageSlot;
  return useSource(slotId, context);
}

/** A single plugin page (the mobile web view): its own parts and the app's. */
function useOwnAndForeignSlot(
  slotId: string,
  context?: Record<string, unknown>,
): SlotContribution[] {
  const own = usePageSlot(slotId, context);
  const foreign = getForeignRuntime()!.useSlot(slotId, context);
  return useMemo(
    () =>
      [...own, ...foreign].sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          a.actionId.localeCompare(b.actionId),
      ),
    [own, foreign],
  );
}

function usePageSlot(
  slotId: string,
  context?: Record<string, unknown>,
): SlotContribution[] {
  const contributions = useSyncExternalStore(
    subscribeToActionRegistry,
    () => getSlotContributions(slotId),
    () => getSlotContributions(slotId),
  );

  const { has, loaded } = usePermissions();

  return useMemo(() => {
    // Render nothing until the grants are known. A button that appears and
    // then vanishes is worse than one that appears a moment late.
    if (!loaded) return [];
    return contributions.filter((contribution) => {
      const permission =
        getActionPermission(contribution.actionId) ?? undefined;
      if (permission && !has(permission)) return false;
      if (!contribution.when) return true;
      try {
        return contribution.when(context ?? {});
      } catch {
        return false;
      }
    });
    // context is compared by value: slot owners build it inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributions, has, loaded, contextKey(context)]);
}

function contextKey(context: Record<string, unknown> | undefined): string {
  if (!context) return "";
  try {
    return JSON.stringify(context);
  } catch {
    // A value that will not serialize still counts as there or not, so a
    // handle filling in changes the key.
    return Object.entries(context)
      .map(([key, value]) => `${key}:${value == null ? "-" : typeof value}`)
      .join(",");
  }
}
