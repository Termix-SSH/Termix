import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table.tsx";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip.tsx";
import {
  X,
  Minus,
  Send,
  Loader2,
  ChevronRight,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  Sparkles,
  Server,
  Activity,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NLUIEngine } from "./engine/types";

interface AIChatPanelProps {
  engine: NLUIEngine;
  onClose: () => void;
  onMinimize: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

interface DisplayMessage {
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  toolName?: string;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Inline CopyButton
// ---------------------------------------------------------------------------
function CopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className={cn(
            "opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover",
            className,
          )}
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {copied ? t("ai.copied") : t("ai.copy")}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// NLUI structured-data renderers
// ---------------------------------------------------------------------------
function NluiTable({ data }: { data: Record<string, unknown>[] }) {
  if (!data.length) return null;
  const cols = Object.keys(data[0]);
  return (
    <div className="border border-edge rounded my-1.5 max-h-60 overflow-auto thin-scrollbar">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="h-7 px-2 text-xs">{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, ri) => (
            <TableRow key={ri}>
              {cols.map((c) => (
                <TableCell key={c} className="py-1 px-2">{String(row[c] ?? "")}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NluiKV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return null;
  return (
    <div className="bg-surface rounded border border-edge p-2.5 my-1.5 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 min-w-0 overflow-hidden">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <span className="text-muted-foreground font-medium">{k}</span>
          <span className="break-all">{String(v ?? "")}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function NluiBadges({ data }: { data: (string | number | boolean)[] }) {
  if (!data.length) return null;
  return (
    <div className="flex flex-wrap gap-1 my-1.5">
      {data.map((item, i) => (
        <Badge key={i} variant="secondary">{String(item)}</Badge>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer (zero deps)
// ---------------------------------------------------------------------------
function renderMarkdown(raw: string): React.ReactNode {
  const blocks = raw.split(/```([\s\S]*?)```/);
  const result: React.ReactNode[] = [];

  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      // Code block — detect nlui structured blocks
      const langMatch = blocks[i].match(/^([\w:.-]+)\n/);
      const lang = langMatch?.[1] ?? "";
      const body = langMatch ? blocks[i].slice(langMatch[0].length) : blocks[i];

      if (lang.startsWith("nlui:")) {
        try {
          const parsed = JSON.parse(body);
          switch (lang) {
            case "nlui:table":
              result.push(<NluiTable key={i} data={parsed} />);
              continue;
            case "nlui:kv":
              result.push(<NluiKV key={i} data={parsed} />);
              continue;
            case "nlui:badges":
              result.push(<NluiBadges key={i} data={parsed} />);
              continue;
          }
        } catch {
          // JSON parse failed — fall through to plain <pre>
        }
      }

      const code = body;
      result.push(
        <div key={i} className="group relative my-1.5 max-w-full">
          <pre className="p-2 bg-surface border border-edge rounded text-[11px] overflow-x-auto thin-scrollbar">
            {code}
          </pre>
          <CopyButton
            text={code}
            className="absolute top-1 right-1"
          />
        </div>,
      );
    } else {
      // Inline text — process line by line
      const lines = blocks[i].split("\n");
      const inlineNodes: React.ReactNode[] = [];

      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        if (j > 0) inlineNodes.push(<br key={`br-${i}-${j}`} />);

        // List items
        if (/^[-*]\s/.test(line)) {
          inlineNodes.push(
            <span key={`li-${i}-${j}`} className="block pl-3">
              {"- "}
              {processInline(line.replace(/^[-*]\s/, ""), `${i}-${j}`)}
            </span>,
          );
        } else {
          inlineNodes.push(
            <React.Fragment key={`t-${i}-${j}`}>
              {processInline(line, `${i}-${j}`)}
            </React.Fragment>,
          );
        }
      }
      result.push(<React.Fragment key={i}>{inlineNodes}</React.Fragment>);
    }
  }

  return result;
}

function processInline(text: string, keyPrefix: string): React.ReactNode {
  // Bold + inline code
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${idx}`}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${keyPrefix}-${idx}`}
          className="px-1 py-0.5 bg-surface border border-edge rounded text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// AIChatPanel
// ---------------------------------------------------------------------------
export function AIChatPanel({
  engine,
  onClose,
  onMinimize,
  onDragStart,
}: AIChatPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]',
      );
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const getAuthToken = (): string => {
    // Electron stores JWT in localStorage; browser uses httpOnly cookie (auto-sent via credentials: 'include')
    return localStorage.getItem("jwt") || document.cookie.match(/(?:^|; )jwt=([^;]*)/)?.[1] || "";
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const convId = await engine.chat(text, {
        conversationId: conversationId || undefined,
        authToken: getAuthToken(),
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + delta,
              };
            }
            return updated;
          });
        },
        onToolCall: (name, args) => {
          setMessages((prev) => [
            ...prev,
            { role: "tool_call", content: args, toolName: name },
          ]);
        },
        onToolResult: (name, result) => {
          setMessages((prev) => [
            ...prev,
            { role: "tool_result", content: result, toolName: name },
          ]);
          setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        },
        onDone: (id) => {
          setConversationId(id);
        },
        onError: (err) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant" && !last.content) {
              updated[updated.length - 1] = {
                ...last,
                content: err.message,
                isError: true,
              };
            }
            return updated;
          });
        },
      });

      if (!conversationId) setConversationId(convId);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev.filter((m) => m.content !== ""),
          {
            role: "assistant",
            content: err instanceof Error ? err.message : "Unknown error",
            isError: true,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.filter((m) => m.content !== "" || m.role === "user"),
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setExpandedTools(new Set());
  };

  const toggleTool = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const fillInput = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-canvas rounded-lg border-2 border-edge shadow-xl overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 bg-elevated border-b border-edge",
          onDragStart && "cursor-grab active:cursor-grabbing",
        )}
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-semibold text-sm">{t("ai.title")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleNewChat}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ai.newChat")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onMinimize}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ai.minimize")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onClose}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ai.close")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
       <div className="overflow-hidden px-3 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4 animate-in fade-in duration-300">
            <Sparkles className="h-8 w-8 text-primary mb-3" />
            <p className="font-semibold text-sm mb-1">{t("ai.welcome")}</p>
            <p className="text-xs text-muted-foreground mb-5">
              {t("ai.welcomeSubtitle")}
            </p>
            <div className="flex flex-col gap-2 w-full max-w-[280px]">
              <button
                onClick={() => fillInput(t("ai.exampleHosts"))}
                className="flex items-center gap-2 px-3 py-2 text-xs text-left border border-edge rounded-md hover:bg-surface transition-colors"
              >
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t("ai.exampleHosts")}
              </button>
              <button
                onClick={() => fillInput(t("ai.exampleStats"))}
                className="flex items-center gap-2 px-3 py-2 text-xs text-left border border-edge rounded-md hover:bg-surface transition-colors"
              >
                <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t("ai.exampleStats")}
              </button>
              <button
                onClick={() => fillInput(t("ai.exampleTunnel"))}
                className="flex items-center gap-2 px-3 py-2 text-xs text-left border border-edge rounded-md hover:bg-surface transition-colors"
              >
                <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {t("ai.exampleTunnel")}
              </button>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((msg, idx) => {
            if (msg.role === "user") {
              return (
                <div
                  key={idx}
                  className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "assistant") {
              if (!msg.content) return null;

              if (msg.isError) {
                return (
                  <div
                    key={idx}
                    className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200"
                  >
                    <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 max-w-[85%] text-sm">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <span>{msg.content}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className="group flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <div className="relative bg-elevated rounded-lg px-3 py-2 max-w-[85%] min-w-0 overflow-hidden text-sm border border-edge">
                    {renderMarkdown(msg.content)}
                    <CopyButton
                      text={msg.content}
                      className="absolute top-1 right-1"
                    />
                  </div>
                </div>
              );
            }

            if (msg.role === "tool_call" || msg.role === "tool_result") {
              const isExpanded = expandedTools.has(idx);
              return (
                <div
                  key={idx}
                  className="flex justify-start px-1 animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <div className="w-full max-w-[85%]">
                    <button
                      onClick={() => toggleTool(idx)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform duration-200",
                          isExpanded && "rotate-90",
                        )}
                      />
                      <Badge
                        variant={
                          msg.role === "tool_call" ? "outline" : "secondary"
                        }
                        className="text-[10px] px-1.5 py-0"
                      >
                        {msg.role === "tool_call"
                          ? t("ai.toolCall")
                          : t("ai.toolResult")}
                      </Badge>
                      <span className="font-mono text-[11px]">
                        {msg.toolName}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "grid transition-all duration-200",
                        isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="group relative mt-1">
                          <pre className="p-2 bg-surface border border-edge rounded text-[11px] overflow-x-auto max-h-40 thin-scrollbar">
                            {formatJSON(msg.content)}
                          </pre>
                          <CopyButton
                            text={msg.content}
                            className="absolute top-1 right-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })}
          {isLoading && (
            <div className="flex items-center gap-1.5 text-muted-foreground px-1 animate-in fade-in duration-200">
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
            </div>
          )}
        </div>
       </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-2 bg-elevated border-t border-edge">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.placeholder")}
            className="min-h-[36px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="shrink-0 h-9 w-9 self-end"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("ai.send")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function formatJSON(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
