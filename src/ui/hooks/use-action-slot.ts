import { useMemo, useSyncExternalStore } from "react";
import {
  getSlotContributions,
  subscribeToActionRegistry,
  getActionPermission,
  type SlotContribution,
} from "@/shell/action-registry";
import { usePermissions } from "@/hooks/use-permissions";

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
    return String(Object.keys(context));
  }
}
