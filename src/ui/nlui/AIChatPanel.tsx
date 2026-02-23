import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  X,
  Minus,
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import type { NLUIEngine } from "./engine/types";
import type { Message } from "./engine/types";

interface AIChatPanelProps {
  engine: NLUIEngine;
  onClose: () => void;
  onMinimize: () => void;
}

interface DisplayMessage {
  role: "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  toolName?: string;
}

export function AIChatPanel({
  engine,
  onClose,
  onMinimize,
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
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Get JWT token from axios interceptor
  const getAuthToken = (): string => {
    const token = localStorage.getItem("token");
    return token || "";
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Add placeholder for streaming response
    const assistantIdx = messages.length + 1;
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
          // Add new assistant placeholder for continuation
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
                content: `Error: ${err.message}`,
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
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      // Remove empty assistant messages
      setMessages((prev) => prev.filter((m) => m.content !== "" || m.role === "user"));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  return (
    <div className="flex flex-col h-full bg-canvas rounded-lg border-2 border-edge shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-elevated border-b border-edge">
        <span className="font-semibold text-sm">{t("ai.title")}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleNewChat}
            title={t("ai.newChat")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onMinimize}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 px-3 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm py-12">
            <p>{t("ai.welcome")}</p>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((msg, idx) => {
            if (msg.role === "user") {
              return (
                <div key={idx} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "assistant") {
              if (!msg.content) return null;
              return (
                <div key={idx} className="flex justify-start">
                  <div className="bg-elevated rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap border border-edge">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "tool_call" || msg.role === "tool_result") {
              const isExpanded = expandedTools.has(idx);
              return (
                <div key={idx} className="flex justify-start px-1">
                  <div className="w-full max-w-[85%]">
                    <button
                      onClick={() => toggleTool(idx)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <Badge
                        variant={
                          msg.role === "tool_call" ? "default" : "secondary"
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
                    {isExpanded && (
                      <pre className="mt-1 p-2 bg-elevated border border-edge rounded text-[11px] overflow-x-auto max-h-40 thin-scrollbar">
                        {formatJSON(msg.content)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            }

            return null;
          })}
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm px-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t("ai.thinking")}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* Input */}
      <div className="p-2 bg-elevated">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.placeholder")}
            className="min-h-[36px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="shrink-0 h-9 w-9"
          >
            <Send className="h-4 w-4" />
          </Button>
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
