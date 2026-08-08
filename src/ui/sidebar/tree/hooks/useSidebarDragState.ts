import { useState } from "react";

/** Drag-in-progress host ids and root drop-zone hover state for the tree. */
export function useSidebarDragState() {
  const [draggedHostIds, setDraggedHostIds] = useState<string[] | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);

  return {
    draggedHostIds,
    setDraggedHostIds,
    rootDragOver,
    setRootDragOver,
  };
}
