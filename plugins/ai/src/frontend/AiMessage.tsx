import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AiMessageProps {
  role: "user" | "assistant";
  content: string;
}

export function AiMessage({ role, content }: AiMessageProps) {
  if (role === "user") {
    return (
      <div className="rounded-none border border-border bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
    );
  }

  return (
    <div className="text-sm leading-relaxed [&_a]:underline [&_code]:font-mono [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
