import React from "react";
import { useTranslation } from "react-i18next";
import { useActionSlot } from "@/hooks/use-action-slot";
import { invokeAction, type SlotContribution } from "@/shell/action-registry";

interface ActionSlotProps {
  slotId: string;
  /**
   * Arguments for the action, read at click time rather than on render. A
   * getter keeps expensive context (a serialized terminal buffer, say) off the
   * render path.
   */
  context?: () => unknown[];
  /** Applied to the default button so a slot owner can match its own controls. */
  className?: string;
  /** Hides the whole slot. For a surface that is contextually unavailable. */
  enabled?: boolean;
  /** Renders a contribution the owner's own way instead of as a button. */
  renderItem?: (
    contribution: SlotContribution,
    invoke: () => void,
  ) => React.ReactNode;
  /** Icon-only, for toolbars that collapse their labels. */
  hideLabels?: boolean;
}

/**
 * Renders whatever plugins have contributed to a named slot.
 *
 * Renders null when there is nothing to show, which covers both "no plugin
 * contributed" and "the user may not see what was contributed". Those two
 * cases are deliberately identical in the DOM: no placeholder, no disabled
 * button, nothing hinting at a feature the user cannot reach.
 */
export function ActionSlot({
  slotId,
  context,
  className,
  enabled = true,
  renderItem,
  hideLabels,
}: ActionSlotProps) {
  const { t } = useTranslation();
  const contributions = useActionSlot(slotId);

  if (!enabled || contributions.length === 0) return null;

  return (
    <>
      {contributions.map((contribution) => {
        const invoke = () => {
          void invokeAction(contribution.actionId, ...(context?.() ?? []));
        };

        if (renderItem) {
          return (
            <React.Fragment key={contribution.actionId}>
              {renderItem(contribution, invoke)}
            </React.Fragment>
          );
        }

        const Icon = contribution.icon;
        const label = t(contribution.titleKey);

        return (
          <button
            key={contribution.actionId}
            type="button"
            className={className}
            aria-label={label}
            title={label}
            onClick={invoke}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            {!hideLabels && label}
          </button>
        );
      })}
    </>
  );
}
