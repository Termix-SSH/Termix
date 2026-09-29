import { useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  dropTargetAt,
  dropTargetRect,
  setSplitDropHitTest,
  useSplitDrag,
} from "./split-drag";

/**
 * Drop zones over the main area while a tab or pane is dragged. Over a
 * split, each pane offers its four edges (split there) and its center (show
 * it there). Over a plain tab only the edges count, to start a new split.
 */
export function SplitDropOverlay({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const drag = useSplitDrag();

  useEffect(
    () =>
      setSplitDropHitTest((x, y, source) => {
        const container = containerRef.current;
        if (!container) return null;
        const bounds = container.getBoundingClientRect();
        if (
          x < bounds.left ||
          x > bounds.right ||
          y < bounds.top ||
          y > bounds.bottom
        ) {
          return null;
        }
        const panes = Array.from(
          container.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
        ).filter((el) => el.getClientRects().length > 0);

        if (panes.length === 0) {
          if (source.kind !== "tab") return null;
          const target = dropTargetAt(bounds, x, y);
          if (target === "center") return null;
          return { paneId: null, target, rect: dropTargetRect(bounds, target) };
        }

        for (const el of panes) {
          const rect = el.getBoundingClientRect();
          if (
            x < rect.left ||
            x > rect.right ||
            y < rect.top ||
            y > rect.bottom
          ) {
            continue;
          }
          const paneId = el.dataset.splitPaneId ?? null;
          if (source.kind === "pane" && source.paneId === paneId) return null;
          const target = dropTargetAt(rect, x, y);
          return { paneId, target, rect: dropTargetRect(rect, target) };
        }
        return null;
      }),
    [containerRef],
  );

  if (!drag) return null;
  const { hover } = drag;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9998]">
      {hover && (
        <div
          className="absolute flex items-center justify-center border-2 border-dashed border-accent-brand bg-accent-brand/15 transition-[left,top,width,height] duration-100"
          style={{
            left: hover.rect.left,
            top: hover.rect.top,
            width: hover.rect.width,
            height: hover.rect.height,
          }}
        >
          <span className="bg-background/90 px-2 py-1 text-xs font-medium text-accent-brand">
            {hover.target === "center"
              ? t("splitScreen.dropHere")
              : t("splitScreen.dropSplit")}
          </span>
        </div>
      )}
      <div
        className="absolute max-w-48 truncate border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-lg"
        style={{ left: drag.x + 12, top: drag.y + 12 }}
      >
        {drag.source.label}
      </div>
    </div>,
    document.body,
  );
}
