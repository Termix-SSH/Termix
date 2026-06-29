import { useState, useCallback } from "react";
import { FileText } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  MarkdownNotesConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { updateHomepageItem } from "@/api/homepage-api";
import { WidgetTitle } from "./WidgetTitle";

function renderMarkdown(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      if (/^### /.test(line))
        return `<h3 class="text-[11px] font-bold mt-2 mb-0.5 text-foreground">${esc(line.slice(4))}</h3>`;
      if (/^## /.test(line))
        return `<h2 class="text-xs font-bold mt-2 mb-0.5 text-foreground">${esc(line.slice(3))}</h2>`;
      if (/^# /.test(line))
        return `<h1 class="text-sm font-bold mt-2 mb-0.5 text-foreground">${esc(line.slice(2))}</h1>`;
      if (/^- /.test(line))
        return `<li class="text-[10px] ml-3 list-disc text-foreground">${inlineFormat(line.slice(2))}</li>`;
      if (/^\d+\. /.test(line))
        return `<li class="text-[10px] ml-3 list-decimal text-foreground">${inlineFormat(line.replace(/^\d+\. /, ""))}</li>`;
      if (line.trim() === "") return "<br/>";
      return `<p class="text-[10px] text-foreground leading-relaxed">${inlineFormat(line)}</p>`;
    })
    .join("");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineFormat(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /`(.+?)`/g,
      '<code class="bg-muted px-0.5 font-mono text-[9px]">$1</code>',
    );
}

function MarkdownNotesWidget({
  widget,
  config,
  isReadOnly,
  onConfigUpdate,
}: WidgetComponentProps<MarkdownNotesConfig>) {
  const { content, backgroundColor, renderMarkdown: doRender } = config;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  const commitEdit = useCallback(async () => {
    setEditing(false);
    if (draft === content) return;
    try {
      await updateHomepageItem(widget.id, {
        config: { ...config, content: draft } as unknown as Record<
          string,
          unknown
        >,
      });
      onConfigUpdate?.({ ...config, content: draft } as unknown as Record<
        string,
        unknown
      >);
    } catch {
      /* ignore */
    }
  }, [draft, content, widget.id, config, onConfigUpdate]);

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden"
      style={backgroundColor ? { background: backgroundColor } : undefined}
    >
      <WidgetTitle title={widget.title} icon={<FileText size={11} />} />
      <div className="flex-1 overflow-auto p-2 relative">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full h-full bg-transparent text-[10px] text-foreground resize-none outline-none border-none leading-relaxed"
            style={{ minHeight: "100%" }}
          />
        ) : doRender ? (
          <div
            className="text-[10px] leading-relaxed cursor-text"
            onDoubleClick={() => {
              if (!isReadOnly) setEditing(true);
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content || "") }}
          />
        ) : (
          <pre
            className="text-[10px] text-foreground leading-relaxed whitespace-pre-wrap break-words font-sans cursor-text"
            onDoubleClick={() => {
              if (!isReadOnly) setEditing(true);
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

registerWidget<MarkdownNotesConfig>({
  id: "markdown_notes",
  name: "Markdown Notes",
  description: "Notes with optional Markdown rendering and inline editing",
  category: "info",
  icon: <FileText size={14} />,
  defaultConfig: { content: "", renderMarkdown: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 3, h: GRID_SIZE * 3 },
  component: MarkdownNotesWidget,
});

export { MarkdownNotesWidget };
