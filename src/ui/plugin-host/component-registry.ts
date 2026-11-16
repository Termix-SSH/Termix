import {
  createElement,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { getForeignRuntime } from "@/components/foreign/foreign-runtime";

/**
 * Components a plugin offers other code by id, through app.registerComponent.
 *
 * The owner decides what the component is and the caller decides where it
 * goes: the ssh-terminal plugin offers "terminal.view", and the collab room,
 * the homepage SSH widget and the file manager render it without importing
 * the terminal. While the owner is off the id resolves to nothing and the
 * caller's fallback shows instead.
 */

type AnyComponent = ComponentType<Record<string, unknown>>;

const components = new Map<string, AnyComponent>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function registerPluginComponent(
  id: string,
  component: AnyComponent,
): () => void {
  components.set(id, component);
  notify();
  return () => {
    if (components.get(id) === component) {
      components.delete(id);
      notify();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPluginComponent(id: string): AnyComponent | undefined {
  return components.get(id);
}

/** The component registered under an id, re-rendering when that changes. */
export function usePluginComponent(id: string): AnyComponent | undefined {
  useSyncExternalStore(subscribe, () => version);
  return components.get(id);
}

/** A single plugin page: its own component, else the app's placeholder. */
function useOwnOrForeignComponent(id: string): AnyComponent | undefined {
  const own = usePluginComponent(id);
  const foreign = getForeignRuntime()!.useComponent(id);
  return own ?? foreign;
}

/**
 * Renders the component another plugin registered under `id`, with the rest
 * of the props passed through, or `fallback` while nobody has registered it.
 */
export function PluginComponent({
  id,
  fallback = null,
  ...props
}: {
  id: string;
  fallback?: ReactNode;
  [prop: string]: unknown;
}): ReactNode {
  // Inside a plugin frame another plugin's component is a placeholder.
  const runtime = getForeignRuntime();
  const useSource = runtime
    ? runtime.withOwn
      ? useOwnOrForeignComponent
      : runtime.useComponent
    : usePluginComponent;
  const Component = useSource(id);
  if (!Component) return fallback as ReactNode;
  return createElement(Component, props);
}
