import { useCallback, useEffect, useMemo, useState } from "react";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import { getSnippets } from "@/api/snippets-api";
import { listAutomations } from "@/api/automations-api";

/**
 * Backs the @-mention picker in the composer.
 *
 * A mention is only ever a name the assistant reads in the message text; it
 * does not grant access to anything. The assistant still has to call a read
 * tool to see the referenced item, so every access stays visible in the
 * transcript rather than being silently attached to the prompt.
 */

export type MentionKind = "host" | "snippet" | "automation";

export interface MentionItem {
  kind: MentionKind;
  id: number;
  label: string;
  detail?: string;
}

/** Extracts the "@partial" the caret currently sits in, if any. */
export function activeMentionQuery(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;

  // Only trigger at a word boundary, so an email address does not open it.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;

  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;

  return { query, start: at };
}

export function useMentions(enabled: boolean) {
  const [items, setItems] = useState<MentionItem[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      const [hosts, snippets, automations] = await Promise.allSettled([
        getSSHHosts(),
        getSnippets(),
        listAutomations(),
      ]);
      if (cancelled) return;

      const collected: MentionItem[] = [];

      if (hosts.status === "fulfilled") {
        for (const host of (hosts.value ?? []) as any[]) {
          collected.push({
            kind: "host",
            id: host.id,
            label: host.name || host.ip,
            detail: host.ip,
          });
        }
      }
      if (snippets.status === "fulfilled") {
        for (const snippet of (snippets.value ?? []) as any[]) {
          collected.push({
            kind: "snippet",
            id: snippet.id,
            label: snippet.name,
          });
        }
      }
      if (automations.status === "fulfilled") {
        for (const automation of (automations.value ?? []) as any[]) {
          collected.push({
            kind: "automation",
            id: automation.id,
            label: automation.name,
          });
        }
      }

      setItems(collected);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const search = useCallback(
    (query: string): MentionItem[] => {
      const needle = query.trim().toLowerCase();
      const matches = needle
        ? items.filter((item) => item.label.toLowerCase().includes(needle))
        : items;
      return matches.slice(0, 8);
    },
    [items],
  );

  return useMemo(() => ({ items, search }), [items, search]);
}
