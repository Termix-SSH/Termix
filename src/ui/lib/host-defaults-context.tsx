/* eslint-disable react-refresh/only-export-components */
/**
 * The host editor's view of host defaults, for the fields it draws.
 *
 * In a host, a field either follows its default (and says where from) or is
 * the host's own (and can be reset). In the defaults editor, a field is either
 * set at the level being edited (and can be cleared) or shows what it
 * inherits. Outside either editor there is no provider and nothing renders.
 */

import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, X } from "lucide-react";
import type {
  HostDefaultSource,
  HostDefaultsLevel,
} from "@/types/host-defaults";
import { usePluginScope } from "@/plugin-host/scope";

export interface HostDefaultsContextValue {
  mode: "host" | "defaults";
  /** The level being edited, in the defaults editor. */
  level?: HostDefaultsLevel;
  /** A host's own value, or a value set at the level being edited. */
  isOwn: (fullKey: string) => boolean;
  /** Where the value it would otherwise have comes from. */
  source: (fullKey: string) => HostDefaultSource | undefined;
  /** Follows the default again, or clears the value at this level. */
  reset: (fullKey: string) => void;
  /** Whether the key can have a default here at all. */
  isAvailable: (fullKey: string) => boolean;
}

export const HostDefaultsContext =
  createContext<HostDefaultsContextValue | null>(null);

export function useHostDefaults(): HostDefaultsContextValue | null {
  return useContext(HostDefaultsContext);
}

/** Whether the editor is editing a level of defaults rather than a host. */
export function useIsDefaultsEditor(): boolean {
  return useContext(HostDefaultsContext)?.mode === "defaults";
}

/**
 * A short key ("fontSize") is the calling plugin's own; core passes a full
 * one ("core.sshPort").
 */
export function useDefaultKey(settingKey: string | undefined): string | null {
  const scope = usePluginScope();
  if (!settingKey) return null;
  if (settingKey.includes(".")) return settingKey;
  return scope ? `${scope}.${settingKey}` : null;
}

export function useSourceLabel(): (
  source: HostDefaultSource | undefined,
) => string {
  const { t } = useTranslation();
  return (source) => {
    switch (source?.level) {
      case "folder":
        return t("hostDefaults.source.folder", {
          name: source.folderName ?? "",
        });
      case "user":
        return t("hostDefaults.source.user");
      case "admin":
        return t("hostDefaults.source.admin");
      default:
        return t("hostDefaults.source.builtin");
    }
  };
}

/**
 * The marker next to a field's label: where an inherited value comes from,
 * or a control to hand an own value back.
 */
export function HostDefaultBadge({ settingKey }: { settingKey: string }) {
  const { t } = useTranslation();
  const context = useHostDefaults();
  const fullKey = useDefaultKey(settingKey);
  const sourceLabel = useSourceLabel();
  if (!context || !fullKey || !context.isAvailable(fullKey)) return null;

  const own = context.isOwn(fullKey);
  const source = context.source(fullKey);
  const from = sourceLabel(source);

  if (own && (context.mode === "defaults" || source)) {
    const defaults = context.mode === "defaults";
    return (
      <button
        type="button"
        onClick={() => context.reset(fullKey)}
        title={
          defaults
            ? t("hostDefaults.clearTitle", { source: from })
            : t("hostDefaults.resetTitle", { source: from })
        }
        className="inline-flex items-center gap-0.5 border border-accent-brand/40 px-1 text-[10px] font-medium normal-case tracking-normal text-accent-brand hover:bg-accent-brand/10"
      >
        {defaults ? (
          <X className="size-2.5" />
        ) : (
          <RotateCcw className="size-2.5" />
        )}
        {defaults ? t("hostDefaults.setHere") : t("hostDefaults.custom")}
      </button>
    );
  }
  if (own || source?.level === "builtin") return null;
  return (
    <span
      title={
        source
          ? t("hostDefaults.inheritedTitle", { source: from })
          : t("hostDefaults.notSetTitle")
      }
      className="border border-border px-1 text-[10px] font-normal normal-case tracking-normal text-muted-foreground"
    >
      {source ? from : t("hostDefaults.notSet")}
    </span>
  );
}

/** Renders its children only when the key can have a default in this editor. */
export function DefaultsOnly({
  settingKey,
  children,
}: {
  settingKey: string;
  children: React.ReactNode;
}) {
  const context = useHostDefaults();
  const fullKey = useDefaultKey(settingKey);
  if (
    context?.mode === "defaults" &&
    fullKey &&
    !context.isAvailable(fullKey)
  ) {
    return null;
  }
  return <>{children}</>;
}

/** Renders its children only when editing a host, never a level of defaults. */
export function HostOnly({ children }: { children: React.ReactNode }) {
  return useIsDefaultsEditor() ? null : <>{children}</>;
}
