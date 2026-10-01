import {
  createElement,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";

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

/** The component registered under an id, re-rendering when that changes. */
export function usePluginComponent(id: string): AnyComponent | undefined {
  useSyncExternalStore(subscribe, () => version);
  return components.get(id);
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
  const Component = usePluginComponent(id);
  if (!Component) return fallback as ReactNode;
  return createElement(Component, props);
}
