import { useState } from "react";

/** Selected-hosts and open-menu/tray id state shared across the tree's rows. */
export function useSidebarSelection() {
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(
    new Set(),
  );
  const [openMenuHostId, setOpenMenuHostId] = useState<string | null>(null);
  const [openTrayHostId, setOpenTrayHostId] = useState<string | null>(null);
  // Hover-mode tray expansion has to live in state, not just CSS: rows are
  // absolutely positioned at virtualizer-computed heights, so a row that grows
  // on hover would overlap the row below unless the height is reserved too.
  const [hoveredHostId, setHoveredHostId] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /** Selects every host id, or deselects them if they're all already selected. */
  function toggleSelectMany(ids: string[]) {
    setSelectedHostIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  return {
    selectedHostIds,
    setSelectedHostIds,
    openMenuHostId,
    setOpenMenuHostId,
    openTrayHostId,
    setOpenTrayHostId,
    hoveredHostId,
    setHoveredHostId,
    toggleSelect,
    toggleSelectMany,
  };
}
