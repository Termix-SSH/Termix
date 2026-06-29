import { Folder } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  FolderConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";

function FolderWidget({ widget, config }: WidgetComponentProps<FolderConfig>) {
  const accentColor =
    config.color ||
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() ||
    "#f59145";

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        background: `${accentColor}10`,
        borderTop: `2px solid ${accentColor}60`,
      }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 select-none">
        <Folder size={11} style={{ color: accentColor }} className="shrink-0" />
        <span className="text-xs font-semibold text-foreground truncate">
          {widget.title || "Folder"}
        </span>
      </div>
    </div>
  );
}

registerWidget<FolderConfig>({
  id: "folder",
  name: "Folder",
  description: "A background card for grouping widgets visually",
  category: "links",
  icon: <Folder size={14} />,
  defaultConfig: { isExpanded: true },
  defaultSize: { w: GRID_SIZE * 14, h: GRID_SIZE * 12 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: FolderWidget as unknown as React.ComponentType<
    WidgetComponentProps<FolderConfig>
  >,
});

export { FolderWidget };
