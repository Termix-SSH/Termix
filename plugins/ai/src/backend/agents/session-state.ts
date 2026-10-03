import { randomUUID } from "node:crypto";
import { fitsText, type AgentSession, type QueuedPrompt } from "./types.js";

export function promptInput(
  s: AgentSession,
  body: Record<string, unknown>,
): QueuedPrompt {
  const text = body.text;
  const attachmentIds = body.attachmentIds ?? [];
  if (
    typeof text !== "string" ||
    !fitsText(text) ||
    !Array.isArray(attachmentIds) ||
    attachmentIds.length > 4 ||
    attachmentIds.some(
      (id) =>
        typeof id !== "string" || !s.attachments?.some((a) => a.id === id),
    ) ||
    (!text.trim() && !attachmentIds.length)
  )
    throw Error("Provide a message and up to four session attachments");
  return { id: randomUUID(), text, attachmentIds: [...new Set(attachmentIds)] };
}
export function updateSession(
  s: AgentSession,
  body: Record<string, unknown>,
): void {
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.length > 120)
      throw Error("Session title must be at most 120 characters");
  }
  if (body.archived !== undefined && typeof body.archived !== "boolean")
    throw Error("Invalid archive state");
  if (
    body.draft !== undefined &&
    (typeof body.draft !== "string" || !fitsText(body.draft))
  )
    throw Error("Draft is too long");
  if (body.title !== undefined) s.title = (body.title as string).trim();
  if (body.archived !== undefined) s.archived = body.archived as boolean;
  if (body.draft !== undefined) s.draft = body.draft as string;
}
export function updateQueue(
  s: AgentSession,
  body: Record<string, unknown>,
): void {
  const queue = s.queue ?? [];
  if (body.operation === "add") {
    if (s.archived || queue.length >= 20)
      throw Error(
        "Restore the session or remove a queued message (maximum 20)",
      );
    s.queue = [...queue, promptInput(s, body)];
  } else if (body.operation === "update") {
    const i = queue.findIndex((p) => p.id === body.id);
    if (i < 0) throw Error("Queued message has already been sent or removed");
    const updated = promptInput(s, body);
    s.queue = queue.map((p, n) => (n === i ? { ...updated, id: p.id } : p));
  } else if (body.operation === "remove") {
    s.queue = queue.filter((p) => p.id !== body.id);
  } else if (body.operation === "continue") s.queuePaused = false;
  else if (body.operation === "pause") s.queuePaused = true;
  else throw Error("Unknown queue operation");
}
