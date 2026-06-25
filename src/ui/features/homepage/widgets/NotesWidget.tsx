import { StickyNote } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type { NotesConfig, WidgetComponentProps } from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function NotesWidget({ widget, config }: WidgetComponentProps<NotesConfig>) {
  const { content, backgroundColor } = config;

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden"
      style={{ background: backgroundColor || undefined }}
    >
      <WidgetTitle title={widget.title} icon={<StickyNote size={11} />} />
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-sans leading-relaxed select-text w-full">
          {content || (
            <span className="text-muted-foreground italic">Empty note...</span>
          )}
        </pre>
      </div>
    </div>
  );
}

registerWidget<NotesConfig>({
  id: "notes",
  name: "Notes",
  description: "A text notes widget",
  category: "info",
  icon: <StickyNote size={14} />,
  defaultConfig: { content: "" },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: NotesWidget,
});

export { NotesWidget };
