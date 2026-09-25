import { useEffect, useMemo, useState } from "react";
import {
  getSshAuthProviders,
  type SshAuthProviderSummary,
} from "@/api/auth-methods-api";
import { useSshAuthEditors } from "@/plugin-host/auth-registry";

/** Shown until the server answers, so the editor does not jump. */
const BUILTIN_TYPES = ["password", "key", "credential", "agent", "none"];

function builtinSummary(type: string): SshAuthProviderSummary {
  return {
    type,
    labelKey: `hosts.filterAuth${type.charAt(0).toUpperCase()}${type.slice(1)}`,
    pluginId: "core",
    fields: [],
    credentialType: type === "password" || type === "key",
    needsUserInteraction: false,
    supportsBackground: type !== "none",
    quickConnect: true,
    available: true,
  };
}

let cache: Promise<SshAuthProviderSummary[]> | null = null;

/** Drops the cached list, e.g. after a plugin was switched on or off. */
export function invalidateSshAuthProviders(): void {
  cache = null;
}

export interface SshAuthTypeOption extends SshAuthProviderSummary {
  /** Plugin-registered editor title, when there is one. */
  editorTitleKey?: string;
}

/**
 * Every SSH auth type the server can connect with, merged with the editors
 * plugins registered in this browser. Types whose plugin is off come back
 * with available: false and missingPlugin set.
 */
export function useSshAuthProviders(): {
  providers: SshAuthTypeOption[];
  loaded: boolean;
  find: (type: string | null | undefined) => SshAuthTypeOption | undefined;
} {
  const editors = useSshAuthEditors();
  const [summaries, setSummaries] = useState<SshAuthProviderSummary[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    cache ??= getSshAuthProviders();
    cache.then((list) => {
      if (!cancelled) setSummaries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const base =
      summaries && summaries.length > 0
        ? summaries
        : BUILTIN_TYPES.map(builtinSummary);
    const byType = new Map<string, SshAuthTypeOption>(
      base.map((summary) => [summary.type, { ...summary }]),
    );
    for (const editor of editors) {
      const existing = byType.get(editor.id);
      if (existing) {
        existing.editorTitleKey = editor.titleKey;
      } else {
        // An editor with no server provider yet: the plugin's backend may
        // still be starting. Offer it; connecting will say what is missing.
        byType.set(editor.id, {
          ...builtinSummary(editor.id),
          labelKey: editor.titleKey,
          pluginId: editor.pluginId ?? "",
          credentialType: false,
          editorTitleKey: editor.titleKey,
        });
      }
    }
    const providers = [...byType.values()];
    return {
      providers,
      loaded: summaries !== null,
      find: (type) =>
        type ? providers.find((provider) => provider.type === type) : undefined,
    };
  }, [summaries, editors]);
}
