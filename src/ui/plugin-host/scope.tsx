/* eslint-disable react-refresh/only-export-components */
import {
  Component,
  createContext,
  Suspense,
  useContext,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { getPluginRecord } from "./plugin-store";

const PluginScopeContext = createContext<string | null>(null);

/** The plugin whose component is rendering, or null in core UI. */
export function usePluginScope(): string | null {
  return useContext(PluginScopeContext);
}

function CrashNotice({
  pluginId,
  onRetry,
}: {
  pluginId: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const name = getPluginRecord(pluginId)?.summary.name ?? pluginId;
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      <span>{t("plugins.runtime.crashed", { name })}</span>
      <button
        type="button"
        className="text-xs underline underline-offset-2 hover:text-foreground"
        onClick={onRetry}
      >
        {t("plugins.runtime.retry")}
      </button>
    </div>
  );
}

interface BoundaryProps {
  pluginId: string;
  children: ReactNode;
}

/** A plugin component that throws takes down itself, never the shell. */
class PluginErrorBoundary extends Component<BoundaryProps, { error: boolean }> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[plugins] ${this.props.pluginId} crashed while rendering`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <CrashNotice
          pluginId={this.props.pluginId}
          onRetry={() => this.setState({ error: false })}
        />
      );
    }
    return this.props.children;
  }
}

function PluginScope({
  pluginId,
  children,
}: {
  pluginId: string;
  children: ReactNode;
}) {
  return (
    <PluginScopeContext.Provider value={pluginId}>
      <PluginErrorBoundary pluginId={pluginId}>
        <Suspense fallback={null}>{children}</Suspense>
      </PluginErrorBoundary>
    </PluginScopeContext.Provider>
  );
}

/**
 * Wraps a plugin's component once, at registration, so every place the shell
 * renders it gets the plugin id for the SDK hooks and an error boundary,
 * without each call site having to remember.
 */
export function withPluginScope<P extends object>(
  pluginId: string,
  Inner: ComponentType<P>,
): ComponentType<P> {
  function Scoped(props: P) {
    return (
      <PluginScope pluginId={pluginId}>
        <Inner {...props} />
      </PluginScope>
    );
  }
  Scoped.displayName = `Plugin(${pluginId}:${Inner.displayName ?? Inner.name ?? "Component"})`;
  return Scoped;
}

/** Renders nothing when a plugin's icon throws, instead of a crash notice. */
class IconBoundary extends Component<BoundaryProps, { error: boolean }> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[plugins] ${this.props.pluginId} icon failed`, error);
  }

  render() {
    return this.state.error ? null : this.props.children;
  }
}

/**
 * A plugin icon the shell renders inline (rail, tab strip, host row). Small
 * enough that a broken one should just disappear, not take the row with it.
 */
export function withIconBoundary<P extends object>(
  pluginId: string,
  Icon: ComponentType<P> | undefined,
): ComponentType<P> | undefined {
  if (!Icon) return undefined;
  function SafeIcon(props: P) {
    return (
      <IconBoundary pluginId={pluginId}>
        <Icon {...props} />
      </IconBoundary>
    );
  }
  SafeIcon.displayName = `PluginIcon(${pluginId})`;
  return SafeIcon;
}

/**
 * A plugin callback core calls while rendering, such as a host action's
 * label. A throw is logged and answered with `fallback`, so one plugin
 * cannot break the host list.
 */
export function guardCallback<A extends unknown[], R>(
  pluginId: string,
  fn: ((...args: A) => R) | undefined,
  fallback: R,
): ((...args: A) => R) | undefined {
  if (!fn) return undefined;
  return (...args: A) => {
    try {
      return fn(...args);
    } catch (error) {
      console.error(`[plugins] ${pluginId} callback failed`, error);
      return fallback;
    }
  };
}
