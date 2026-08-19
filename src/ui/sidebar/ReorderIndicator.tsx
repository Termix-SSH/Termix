/**
 * Drop indicator for sidebar drag-to-reorder.
 *
 * Drawn once by the tree at an absolute offset from the virtualizer's own
 * slot geometry, never by the rows themselves. Rows can't place this
 * correctly: in hover mode the hovered row expands its action tray while the
 * row below stays collapsed, so a bar at the hovered row's bottom edge and
 * one at the next row's top edge land in two different places. That produced
 * two candidate lines whose visibility flickered with the pointer.
 */
export function ReorderIndicator({ top }: { top: number }) {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 h-0.5 bg-accent-brand pointer-events-none z-30"
      style={{ top: top - 1 }}
    >
      <span className="absolute -left-px -top-[3px] size-2 bg-accent-brand" />
      <span className="absolute -right-px -top-[3px] size-2 bg-accent-brand" />
    </div>
  );
}
