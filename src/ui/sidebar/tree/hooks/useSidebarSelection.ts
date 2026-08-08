import { useState } from "react";

/** Selected-hosts and open-menu/tray id state shared across the tree's rows. */
export function useSidebarSelection() {
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(
    new Set(),
  );
  const [openMenuHostId, setOpenMenuHostId] = useState<string | null>(null);
  const [openTrayHostId, setOpenTrayHostId] = useState<string | null>(null);

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

  return {
    selectedHostIds,
    setSelectedHostIds,
    openMenuHostId,
    setOpenMenuHostId,
    openTrayHostId,
    setOpenTrayHostId,
    toggleSelect,
  };
}
