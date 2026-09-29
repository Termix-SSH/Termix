import { useEffect, useState } from "react";
import { usePluginApi } from "@termix/plugin-sdk/frontend";
import { adminOptions } from "./AdminUserSnippets";

export interface SnippetOption {
  id: number;
  name: string;
}

/**
 * The user's snippets as picker options: their own, or the target user's
 * while an admin edits that user's host. `loaded` turns true once the list
 * came back, so a picker can tell "no snippets" from "not loaded yet".
 */
export function useSnippetOptions(targetUserId?: string): {
  options: SnippetOption[];
  loaded: boolean;
} {
  const api = usePluginApi();
  const [state, setState] = useState<{
    options: SnippetOption[];
    loaded: boolean;
  }>({ options: [], loaded: false });

  useEffect(() => {
    let cancelled = false;
    const request = targetUserId
      ? api.get("/", adminOptions(targetUserId))
      : api.get("/");
    request
      .then((response) => {
        const raw = response.data as unknown;
        const list = Array.isArray(raw)
          ? raw
          : ((raw as { snippets?: unknown[] })?.snippets ?? []);
        const options = (list as Array<{ id?: unknown; name?: unknown }>)
          .filter((row) => typeof row.id === "number")
          .map((row) => ({
            id: row.id as number,
            name: typeof row.name === "string" ? row.name : `#${row.id}`,
          }));
        if (!cancelled) setState({ options, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [api, targetUserId]);

  return state;
}
