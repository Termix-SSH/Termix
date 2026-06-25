import { Bookmark, ExternalLink } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  BookmarkListConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";

function BookmarkListWidget({
  config,
  widget,
  isReadOnly,
}: WidgetComponentProps<BookmarkListConfig>) {
  const { links } = config;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {widget.title && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
          <Bookmark size={11} className="text-accent-brand shrink-0" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {widget.title}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto p-3 gap-1 flex flex-col">
        {links.length === 0 && (
          <span className="text-xs text-muted-foreground italic">
            No bookmarks
          </span>
        )}
        {links.map((link, i) =>
          isReadOnly ? (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-foreground py-1"
            >
              <Bookmark size={10} className="text-muted-foreground shrink-0" />
              <span className="truncate">{link.label || link.url}</span>
            </div>
          ) : (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-foreground hover:text-primary py-1 no-underline group"
            >
              <Bookmark size={10} className="text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{link.label || link.url}</span>
              <ExternalLink
                size={8}
                className="text-muted-foreground/0 group-hover:text-muted-foreground/60 shrink-0"
              />
            </a>
          ),
        )}
      </div>
    </div>
  );
}

registerWidget<BookmarkListConfig>({
  id: "bookmark_list",
  name: "Bookmarks",
  description: "A list of quick links",
  category: "links",
  icon: <Bookmark size={14} />,
  defaultConfig: { links: [] },
  defaultSize: { w: GRID_SIZE * 9, h: GRID_SIZE * 10 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: BookmarkListWidget,
});

export { BookmarkListWidget };
