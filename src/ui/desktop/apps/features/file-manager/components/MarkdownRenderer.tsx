import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark as syntaxTheme } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownRendererProps {
  content: string;
  compact?: boolean;
}

export function MarkdownRenderer({
  content,
  compact = false,
}: MarkdownRendererProps) {
  const h1Class = compact
    ? "text-2xl font-bold mb-4 mt-6 text-foreground border-b border-border pb-2"
    : "text-3xl font-bold mb-6 mt-8 text-foreground border-b border-border pb-2";
  const h2Class = compact
    ? "text-xl font-semibold mb-3 mt-5 text-foreground border-b border-border pb-1"
    : "text-2xl font-semibold mb-4 mt-6 text-foreground border-b border-border pb-1";
  const h3Class = compact
    ? "text-lg font-semibold mb-2 mt-4 text-foreground"
    : "text-xl font-semibold mb-3 mt-4 text-foreground";
  const h4Class = compact
    ? "text-base font-semibold mb-2 mt-3 text-foreground"
    : "text-lg font-semibold mb-2 mt-3 text-foreground";
  const pClass = compact
    ? "mb-3 text-foreground leading-relaxed"
    : "mb-4 text-foreground leading-relaxed";
  const listClass = compact
    ? "mb-3 ml-4 text-foreground"
    : "mb-4 ml-6 text-foreground";
  const quoteClass = compact
    ? "border-l-4 border-blue-500 pl-3 mb-3 italic text-muted-foreground bg-muted/30 py-1"
    : "border-l-4 border-blue-500 pl-4 mb-4 italic text-muted-foreground bg-muted/30 py-2";
  const tableWrapClass = compact
    ? "mb-3 overflow-x-auto thin-scrollbar"
    : "mb-4 overflow-x-auto thin-scrollbar";
  const tableClass = compact
    ? "min-w-full border border-border rounded-lg text-sm"
    : "min-w-full border border-border rounded-lg";
  const thClass = compact
    ? "px-3 py-2 text-left font-semibold text-foreground"
    : "px-4 py-2 text-left font-semibold text-foreground";
  const tdClass = compact
    ? "px-3 py-2 text-foreground"
    : "px-4 py-2 text-foreground";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <SyntaxHighlighter
              style={syntaxTheme}
              language={match[1]}
              PreTag="div"
              className="rounded-lg"
              {...props}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          ) : (
            <code
              className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },
        h1: ({ children }) => <h1 className={h1Class}>{children}</h1>,
        h2: ({ children }) => <h2 className={h2Class}>{children}</h2>,
        h3: ({ children }) => <h3 className={h3Class}>{children}</h3>,
        h4: ({ children }) => <h4 className={h4Class}>{children}</h4>,
        p: ({ children }) => <p className={pClass}>{children}</p>,
        ul: ({ children }) => (
          <ul className={`${listClass} list-disc`}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className={`${listClass} list-decimal`}>{children}</ol>
        ),
        li: ({ children }) => (
          <li className="mb-1 text-foreground">{children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className={quoteClass}>{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className={tableWrapClass}>
            <table className={tableClass}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-border">{children}</tr>
        ),
        th: ({ children }) => <th className={thClass}>{children}</th>,
        td: ({ children }) => <td className={tdClass}>{children}</td>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
