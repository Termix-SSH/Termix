import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAllWidgetTypes } from "../widgets/WidgetRegistry";
import type { ContextMenuState, WidgetTypeId } from "@/types/homepage-types";

interface AddWidgetMenuProps {
  state: ContextMenuState;
  onAdd: (typeId: WidgetTypeId, canvasX: number, canvasY: number) => void;
  onClose: () => void;
}

const CATEGORY_ORDER = ["links", "info", "system", "monitoring"] as const;

const MARGIN = 8;

export function AddWidgetMenu({ state, onAdd, onClose }: AddWidgetMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const allTypes = getAllWidgetTypes();
  const [pos, setPos] = useState({ left: state.screenX, top: state.screenY });
  const [selectedCat, setSelectedCat] = useState<
    (typeof CATEGORY_ORDER)[number]
  >(CATEGORY_ORDER[0]);
  const categoryLabels: Record<(typeof CATEGORY_ORDER)[number], string> = {
    links: t("homepage.categoryLinks"),
    info: t("homepage.categoryInfo"),
    system: t("homepage.categorySystem"),
    monitoring: t("homepage.categoryMonitoring"),
  };

  useLayoutEffect(() => {
    if (!state.visible || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = state.screenX;
    let top = state.screenY;

    if (state.anchorRect) {
      left = state.anchorRect.right - rect.width;
      top = state.anchorRect.top - rect.height - MARGIN;
    }

    if (left + rect.width > vw - MARGIN) left = vw - rect.width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    if (top < MARGIN) {
      top = state.anchorRect
        ? state.anchorRect.bottom + MARGIN
        : state.screenY + MARGIN;
    }
    if (top + rect.height > vh - MARGIN) top = vh - rect.height - MARGIN;
    if (top < MARGIN) top = MARGIN;

    setPos({ left, top });
  }, [state.visible, state.screenX, state.screenY, state.anchorRect]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const visibleCategories = CATEGORY_ORDER.filter((cat) =>
    allTypes.some((type) => type.category === cat),
  );

  const selectedTypes = allTypes.filter(
    (type) => type.category === selectedCat,
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border shadow-xl min-w-[220px] flex flex-col"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: state.visible ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-accent-brand">
          {t("homepage.addWidget")}
        </span>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 shrink-0">
        {visibleCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCat(cat)}
            className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              selectedCat === cat
                ? "bg-accent-brand text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {/* Widget list */}
      <div className="overflow-y-auto" style={{ maxHeight: "240px" }}>
        {selectedTypes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground/60">
            No widgets in this category
          </div>
        ) : (
          selectedTypes.map((type) => (
            <button
              key={type.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => {
                onAdd(type.id, state.canvasX, state.canvasY);
                onClose();
              }}
            >
              <span className="text-accent-brand shrink-0">{type.icon}</span>
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{type.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {type.description}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
