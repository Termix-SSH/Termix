/**
 * Other plugins' parts as plain data for a frame or a mobile web view: no
 * functions, icons by name, and each component as a marker the other side
 * turns into a placeholder. The real components stay on this side.
 */

import type { ComponentType } from "react";
import i18n from "@/i18n/i18n";
import type { SlotContribution } from "@/shell/action-registry";
import type { RegisteredExtension } from "../extension-registry";
import {
  iconToWire,
  isComponentObject,
  isReactElement,
} from "@/plugin-frame/wire";
import type { FrameFit } from "./PluginFrameView";
import { extensionFit } from "./slot-fit";

export interface PartEntry {
  pluginId: string;
  component: ComponentType<Record<string, unknown>>;
  fit: FrameFit;
}

export interface BuiltList {
  items: Record<string, unknown>[];
  /** itemKey -> the real part. */
  entries: Map<string, PartEntry>;
  /** Buttons in the list, which the frame may run. */
  actions: Set<string>;
  /** Translated titles under their keys. */
  strings: Record<string, string>;
}

export function marker(key: string) {
  return { $foreign: key };
}

function translated(key: unknown, out: Record<string, string>) {
  if (typeof key !== "string" || !key || key.length > 300) return;
  const text = i18n.t(key);
  if (typeof text === "string" && text !== key) out[key] = text.slice(0, 2000);
}

/** Plain data: no functions, icons by name, no elements. */
export function plainField(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return value;
  }
  if (kind === "function") return iconToWire(value) ?? undefined;
  if (isReactElement(value) || isComponentObject(value)) {
    return iconToWire(value) ?? undefined;
  }
  if (depth > 4 || kind !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => plainField(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as object)) {
    const next = plainField(item, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function slotItems(
  contributions: SlotContribution[],
  fit: FrameFit,
): BuiltList {
  const out: BuiltList = {
    items: [],
    entries: new Map(),
    actions: new Set(),
    strings: {},
  };
  for (const contribution of contributions) {
    if (contribution.kind === "data") continue;
    translated(contribution.titleKey, out.strings);
    translated(contribution.descriptionKey, out.strings);
    const hasComponent =
      contribution.kind === "component" && !!contribution.component;
    if (hasComponent) {
      out.entries.set(contribution.actionId, {
        pluginId: contribution.pluginId ?? "",
        component: contribution.component!,
        fit,
      });
    } else {
      out.actions.add(contribution.actionId);
    }
    out.items.push({
      key: contribution.actionId,
      actionId: contribution.actionId,
      titleKey: contribution.titleKey,
      descriptionKey: contribution.descriptionKey,
      icon: iconToWire(contribution.icon),
      kind: contribution.kind,
      order: contribution.order,
      pluginId: contribution.pluginId,
      fit,
      component: hasComponent ? marker(contribution.actionId) : undefined,
    });
  }
  return out;
}

/** Extension items, leaving out the ones `skip` added itself. */
export function extensionItems(
  extensions: RegisteredExtension[],
  skip?: string,
): BuiltList {
  const out: BuiltList = {
    items: [],
    entries: new Map(),
    actions: new Set(),
    strings: {},
  };
  for (const extension of extensions) {
    if (skip && extension.pluginId === skip) continue;
    const { components, pluginId, ...rest } = extension as Record<
      string,
      unknown
    > & { components?: Record<string, unknown> };
    const parts: Record<string, unknown> = {};
    for (const [name, component] of Object.entries(components ?? {})) {
      if (!component) continue;
      const key = `${extension.id}\u0000${name}`;
      out.entries.set(key, {
        pluginId: String(pluginId ?? ""),
        component: component as ComponentType<Record<string, unknown>>,
        fit: extensionFit(name),
      });
      parts[name] = marker(key);
    }
    out.items.push({
      ...(plainField(rest) as Record<string, unknown>),
      pluginId,
      components: parts,
      key: extension.id,
    });
  }
  return out;
}

export function componentItems(
  id: string,
  component: ComponentType<Record<string, unknown>> | undefined,
): BuiltList {
  const out: BuiltList = {
    items: [],
    entries: new Map(),
    actions: new Set(),
    strings: {},
  };
  if (component) {
    out.entries.set("component", {
      pluginId: id.split(".")[0],
      component,
      fit: "fill",
    });
    out.items.push({
      key: "component",
      fit: "fill",
      component: marker("component"),
    });
  }
  return out;
}
