/* eslint-disable react-refresh/only-export-components */
/**
 * Another plugin's part, drawn where it sits. In the page that is just the
 * component. Inside a plugin frame it is a placeholder: the shell draws the
 * other plugin's own view over it, clipped to this frame.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefCallback,
} from "react";
import { foreignTargetOf, getForeignRuntime } from "./foreign-runtime";

const InteractiveContext = createContext(true);

/**
 * Foreign views inside take no clicks while `interactive` is false, so an
 * edit mode can drag and resize the boxes around them.
 */
export function ForeignInteractive({
  interactive,
  children,
}: {
  interactive: boolean;
  children?: ReactNode;
}) {
  return (
    <InteractiveContext.Provider value={interactive}>
      {children}
    </InteractiveContext.Provider>
  );
}

export interface ForeignSlotProps {
  /** A component from useSlotContributions, useExtensions or usePluginComponent. */
  of: ComponentType<Record<string, unknown>> | undefined;
  props?: Record<string, unknown>;
  /** False while the view should let clicks through (an edit mode). */
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ForeignSlot({
  of,
  props,
  interactive,
  className,
  style,
}: ForeignSlotProps) {
  const inherited = useContext(InteractiveContext);
  const runtime = getForeignRuntime();
  const target = foreignTargetOf(of);
  if (!of) return null;
  if (runtime && target) {
    const Placeholder = runtime.Placeholder;
    return (
      <Placeholder
        target={target}
        props={props ?? {}}
        interactive={inherited && interactive !== false}
        className={className}
        style={style}
      />
    );
  }
  const Component = of;
  return <Component {...(props ?? {})} />;
}

/** Whether interactive is on here (for placeholders). */
export function useForeignInteractive(): boolean {
  return useContext(InteractiveContext);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * For menus, popovers and drag previews: while the element is on screen,
 * other plugins' views under it are hidden, since the shell draws them over
 * this frame. Does nothing in the page.
 */
export function useForeignOccluder<T extends Element>(
  forwarded?: Ref<T>,
): RefCallback<T> {
  const stop = useRef<(() => void) | null>(null);
  const forwardedRef = useRef(forwarded);
  forwardedRef.current = forwarded;
  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
    },
    [],
  );
  return useCallback((node: T | null) => {
    stop.current?.();
    stop.current = null;
    const runtime = getForeignRuntime();
    if (node && runtime) stop.current = runtime.addOccluder(node);
    assignRef(forwardedRef.current, node);
  }, []);
}

/** A box that hides other plugins' views under it while it is mounted. */
export function ForeignOccluder(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useForeignOccluder<HTMLDivElement>();
  return <div ref={ref} {...props} />;
}
