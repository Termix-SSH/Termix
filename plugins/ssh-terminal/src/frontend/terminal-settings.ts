import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePluginApi,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
import { getClientSettings, type TerminalClientSettings } from "./terminal-api";
import {
  DEFAULT_MOSH_COMMAND,
  DEFAULT_USER_SETTINGS,
  readHostTerminalSettings,
  resolveTerminalSettings,
  type TerminalAppearance,
  type TerminalBehavior,
  type TerminalUserSettings,
} from "../shared/terminal-settings";

/**
 * The signed-in user's terminal settings, fetched once and shared by every
 * terminal. Invalidated when one of this plugin's settings is saved.
 */

let cached: TerminalClientSettings | null = null;
let pending: Promise<TerminalClientSettings> | null = null;
const listeners = new Set<() => void>();

export function loadTerminalClientSettings(
  api: PluginApiClient,
): Promise<TerminalClientSettings> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    const request = getClientSettings(api)
      .then((settings) => {
        if (pending === request) cached = settings;
        return settings;
      })
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
  }
  return pending;
}

export function peekTerminalClientSettings(): TerminalClientSettings | null {
  return cached;
}

/** Drops the cache and has every mounted terminal read the settings again. */
export function invalidateTerminalClientSettings(): void {
  cached = null;
  pending = null;
  for (const listener of [...listeners]) listener();
}

export function resetTerminalClientSettings(): void {
  cached = null;
  pending = null;
  listeners.clear();
}

export function useTerminalClientSettings(): TerminalClientSettings | null {
  const api = usePluginApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [value, setValue] = useState<TerminalClientSettings | null>(cached);

  useEffect(() => {
    let active = true;
    const load = () => {
      loadTerminalClientSettings(apiRef.current)
        .then((settings) => {
          if (active) setValue(settings);
        })
        .catch(() => {
          // A guest on a share link has no account to read settings for.
        });
    };
    load();
    listeners.add(load);
    return () => {
      active = false;
      listeners.delete(load);
    };
  }, []);

  return value;
}

export type ResolvedTerminalConfig = TerminalAppearance & TerminalBehavior;

export interface TerminalSettingsForHost {
  config: ResolvedTerminalConfig;
  user: TerminalUserSettings;
}

/** This plugin's host values off a host record, as the host payload carries them. */
export function hostTerminalValues(
  host: object | null | undefined,
): Record<string, unknown> | undefined {
  const settings = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> } | null
  )?.pluginSettings;
  return settings?.["ssh-terminal"];
}

export function resolveForHost(
  host: object | null | undefined,
): ResolvedTerminalConfig {
  const resolved = resolveTerminalSettings(
    readHostTerminalSettings(hostTerminalValues(host)),
  );
  return {
    ...resolved,
    moshCommand: resolved.moshCommand || DEFAULT_MOSH_COMMAND,
  };
}

/** What a terminal on this host runs with, kept current as settings change. */
export function useTerminalSettings(
  host: object | null | undefined,
): TerminalSettingsForHost {
  const client = useTerminalClientSettings();
  const own = hostTerminalValues(host);
  const ownKey = own ? JSON.stringify(own) : "";
  return useMemo(() => {
    const user = client?.user ?? DEFAULT_USER_SETTINGS;
    return { config: resolveForHost(host), user };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownKey, client]);
}
