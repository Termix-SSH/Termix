import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Textarea } from "@termix/plugin-sdk/ui";
import type { AgentSession } from "../../backend/agents/types";
import { aiApp } from "../app-ref";
import { Attachments } from "./Attachments";

export interface SessionActions {
  session: AgentSession;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  onUpdated: (s: AgentSession) => void;
}
export function AgentComposer({
  session: s,
  busy,
  action,
  onUpdated,
  onComposition,
}: SessionActions & { onComposition: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(s.draft ?? "");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const composing = useRef(false);
  const draft = useRef({ text, changed: false });
  const draftWrites = useRef(Promise.resolve());
  const persistDraft = useCallback(() => {
    if (!draft.current.changed) return;
    const value = draft.current.text;
    draft.current.changed = false;
    draftWrites.current = draftWrites.current
      .catch(() => undefined)
      .then(async () => {
        await aiApp().api.patch(`/agents/${s.id}`, { draft: value });
      });
    return draftWrites.current;
  }, [s.id]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void persistDraft()?.catch(() => {
        draft.current.changed = true;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [text, persistDraft]);
  useEffect(
    () => () => {
      void persistDraft()?.catch(() => undefined);
    },
    [persistDraft],
  );
  function change(value: string) {
    draft.current = { text: value, changed: true };
    setText(value);
  }
  async function refresh() {
    onUpdated((await aiApp().api.get<AgentSession>(`/agents/${s.id}`)).data);
  }
  async function queue(body: unknown) {
    await aiApp().api.post(`/agents/${s.id}/queue`, body);
    await refresh();
  }
  const canSend =
    !busy &&
    !s.archived &&
    ["ready", "running"].includes(s.status) &&
    (!!text.trim() || !!attachmentIds.length);
  return (
    <div className="border-t p-3 space-y-2">
      {!!s.queue?.length && (
        <section
          aria-label={t("agents.queue")}
          className="max-h-48 overflow-auto space-y-2"
        >
          <div className="flex items-center gap-2">
            <strong>
              {t("agents.queue")} ({s.queue.length})
            </strong>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  queue({ operation: s.queuePaused ? "continue" : "pause" }),
                )
              }
            >
              {t(s.queuePaused ? "agents.continueQueue" : "agents.pauseQueue")}
            </Button>
          </div>
          {s.queue.map((p) => (
            <div key={p.id} className="rounded border p-2 text-sm">
              {editing === p.id ? (
                <Textarea
                  aria-label={t("agents.editQueued")}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
              ) : (
                <p className="whitespace-pre-wrap">{p.text}</p>
              )}
              {!!p.attachmentIds.length && (
                <p>
                  {p.attachmentIds
                    .map((id) => s.attachments?.find((a) => a.id === id)?.name)
                    .join(", ")}
                </p>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (editing !== p.id) {
                    setEditing(p.id);
                    setEditText(p.text);
                    return;
                  }
                  void action(async () => {
                    await queue({
                      operation: "update",
                      id: p.id,
                      text: editText,
                      attachmentIds: p.attachmentIds,
                    });
                    setEditing(null);
                  });
                }}
              >
                {t(editing === p.id ? "agents.save" : "agents.editQueued")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(() => queue({ operation: "remove", id: p.id }))
                }
              >
                {t("agents.remove")}
              </Button>
            </div>
          ))}
        </section>
      )}
      <Attachments
        session={s}
        busy={busy}
        action={action}
        onUpdated={onUpdated}
        selected={attachmentIds}
        onSelected={setAttachmentIds}
      >
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSend) return;
            void action(async () => {
              if (s.status === "running" || s.queue?.length)
                await queue({ operation: "add", text, attachmentIds });
              else {
                await aiApp().api.post(`/agents/${s.id}/input`, {
                  type: "prompt",
                  text,
                  attachmentIds,
                });
                await refresh();
              }
              change("");
              setAttachmentIds([]);
              await persistDraft();
            });
          }}
        >
          <Textarea
            aria-label={t("agents.prompt")}
            placeholder={t("agents.prompt")}
            value={text}
            onChange={(e) => change(e.target.value)}
            rows={3}
            onCompositionStart={() => {
              composing.current = true;
              onComposition(true);
            }}
            onCompositionEnd={() => {
              composing.current = false;
              onComposition(false);
            }}
            onKeyDown={(e) => {
              if (
                e.key !== "Enter" ||
                e.shiftKey ||
                e.ctrlKey ||
                e.altKey ||
                e.metaKey ||
                e.nativeEvent.isComposing ||
                e.nativeEvent.keyCode === 229 ||
                composing.current
              )
                return;
              e.preventDefault();
              if (!e.repeat) e.currentTarget.form?.requestSubmit();
            }}
          />
          <Button type="submit" disabled={!canSend}>
            {t(
              s.status === "running" || s.queue?.length
                ? "agents.enqueue"
                : "agents.send",
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || s.status !== "running"}
            onClick={() =>
              void action(async () => {
                await aiApp().api.post(`/agents/${s.id}/input`, {
                  type: "cancel",
                });
                await refresh();
              })
            }
          >
            {t("agents.interrupt")}
          </Button>
        </form>
      </Attachments>
      <p className="text-xs text-muted-foreground">{t("agents.shortcuts")}</p>
    </div>
  );
}
