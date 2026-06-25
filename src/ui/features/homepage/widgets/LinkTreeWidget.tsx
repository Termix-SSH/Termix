import { useRef } from "react";
import { List, ExternalLink } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  LinkTreeConfig,
  LinkTreeLink,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function TreeLink({
  link,
  compact,
  isReadOnly,
}: {
  link: LinkTreeLink;
  compact: boolean;
  isReadOnly?: boolean;
}) {
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);

  const content = (
    <div
      className={`group flex items-center gap-1.5 ${compact ? "py-0.5" : "py-1"} pl-2 pr-1 hover:bg-muted/40 transition-colors overflow-hidden`}
    >
      <ExternalLink
        size={9}
        className="shrink-0 text-muted-foreground group-hover:text-accent-brand transition-colors"
      />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-medium text-foreground truncate">
          {link.label}
        </span>
        {!compact && link.description && (
          <span className="text-[9px] text-muted-foreground truncate">
            {link.description}
          </span>
        )}
      </div>
    </div>
  );

  if (isReadOnly || !link.url) return content;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block no-underline"
      onMouseDown={(e) => {
        mouseDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const s = mouseDownRef.current;
        if (
          s &&
          (Math.abs(e.clientX - s.x) > 4 || Math.abs(e.clientY - s.y) > 4)
        )
          e.preventDefault();
        mouseDownRef.current = null;
      }}
    >
      {content}
    </a>
  );
}

function LinkTreeWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<LinkTreeConfig>) {
  const { sections, compact } = config;

  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        No sections configured
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<List size={11} />} />
      <div className="flex-1 overflow-auto">
        {sections.map((section, si) => (
          <div key={si}>
            {section.heading && (
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 border-b border-border/30">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                  {section.heading}
                </span>
              </div>
            )}
            {section.links.map((link, li) => (
              <TreeLink
                key={li}
                link={link}
                compact={compact}
                isReadOnly={isReadOnly}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<LinkTreeConfig>({
  id: "link_tree",
  name: "Link Tree",
  description: "Grouped links organized into labeled sections",
  category: "links",
  icon: <List size={14} />,
  defaultConfig: { sections: [], compact: false },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 12 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 4 },
  component: LinkTreeWidget,
});

export { LinkTreeWidget };
