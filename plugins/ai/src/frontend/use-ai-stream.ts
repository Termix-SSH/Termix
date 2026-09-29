import { getErrorMessage } from "./errors";
import { useCallback, useRef, useState } from "react";
import { aiApp } from "./app-ref";
import type { AiProposal } from "./ai-api";

/**
 * Drives the chat stream.
 *
 * EventSource cannot POST, and the request carries a message body, so this
 * reads the SSE frames off a fetch response by hand.
 */

export interface ToolActivity {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface StreamState {
  streaming: boolean;
  assistantText: string;
  tools: ToolActivity[];
  proposals: AiProposal[];
  error: string | null;
  conversationId: number | null;
}

const INITIAL: StreamState = {
  streaming: false,
  assistantText: "",
  tools: [],
  proposals: [],
  error: null,
  conversationId: null,
};

export function useAiStream() {
  const [state, setState] = useState<StreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  // The run's own cleanup clears abortRef, after it has handed its steps over.
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, streaming: false }));
  }, []);

  const send = useCallback(
    async (input: {
      message: string;
      providerId: number;
      model?: string;
      conversationId?: number | null;
      activeTab?: string | null;
      /**
       * Called however the run ends, with its steps, which are then cleared
       * from the live state. Keeping them is up to the caller.
       */
      onComplete?: (
        conversationId: number | null,
        reply: string,
        tools: ToolActivity[],
      ) => void;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        streaming: true,
        assistantText: "",
        tools: [],
        proposals: [],
        error: null,
        conversationId: input.conversationId ?? null,
      });

      let conversationId = input.conversationId ?? null;
      let replyText = "";
      let toolSequence = 0;
      const runTools: ToolActivity[] = [];

      const finish = (error?: string | null) => {
        // A newer send took over; this run's state is already gone.
        if (abortRef.current !== controller) return;
        input.onComplete?.(conversationId, replyText, runTools);
        setState((prev) => ({
          ...prev,
          streaming: false,
          assistantText: "",
          tools: [],
          ...(error ? { error } : {}),
        }));
      };

      try {
        const response = await aiApp().fetch("chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: input.message,
            providerId: input.providerId,
            model: input.model,
            conversationId: input.conversationId ?? undefined,
            activeTab: input.activeTab ?? undefined,
          }),
        });

        if (!response.ok) {
          let message = "The assistant could not be reached";
          try {
            message = (await response.json()).error ?? message;
          } catch {
            // Keep the generic message.
          }
          setState((prev) => ({ ...prev, streaming: false, error: message }));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setState((prev) => ({
            ...prev,
            streaming: false,
            error: "The assistant returned an empty response",
          }));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");

            if (!line.startsWith("data:")) continue;

            let event: any;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (event.type === "conversation") {
              conversationId = event.conversationId;
              setState((prev) => ({
                ...prev,
                conversationId: event.conversationId,
              }));
            } else if (event.type === "token") {
              replyText += event.text;
              setState((prev) => ({
                ...prev,
                assistantText: prev.assistantText + event.text,
              }));
            } else if (event.type === "tool_call") {
              // The id is assigned here rather than inside the updater: React
              // may run an updater more than once, and deriving the id from
              // prev.tools.length appended a duplicate entry that no result
              // could ever match, leaving it stuck on "running".
              const activityId = `tool-${toolSequence++}`;
              runTools.push({
                id: activityId,
                name: event.name,
                arguments: event.arguments ?? {},
              });
              setState((prev) => ({
                ...prev,
                tools: [
                  ...prev.tools,
                  {
                    id: activityId,
                    name: event.name,
                    arguments: event.arguments ?? {},
                  },
                ],
              }));
            } else if (event.type === "tool_result") {
              for (let i = runTools.length - 1; i >= 0; i -= 1) {
                if (
                  runTools[i].name === event.name &&
                  !("result" in runTools[i])
                ) {
                  runTools[i] = { ...runTools[i], result: event.result };
                  break;
                }
              }
              setState((prev) => {
                const tools = [...prev.tools];
                // Attach to the most recent call of this tool awaiting a result.
                for (let i = tools.length - 1; i >= 0; i -= 1) {
                  if (tools[i].name === event.name && !("result" in tools[i])) {
                    tools[i] = { ...tools[i], result: event.result };
                    break;
                  }
                }
                return { ...prev, tools };
              });
            } else if (event.type === "proposal") {
              setState((prev) => ({
                ...prev,
                proposals: [...prev.proposals, event.proposal],
              }));
            } else if (event.type === "error") {
              setState((prev) => ({ ...prev, error: event.message }));
            }
          }
        }

        finish();
      } catch (error) {
        finish(
          controller.signal.aborted
            ? null
            : getErrorMessage(error, "The assistant stopped unexpectedly"),
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  return { state, send, stop, reset, setState };
}
