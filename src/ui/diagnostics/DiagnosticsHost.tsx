import { lazy, Suspense, useEffect, useState } from "react";
import { LoadingState } from "@/components/loading-state";
import {
  diagnosticsRequested,
  isDiagnosticsShortcut,
  OPEN_DIAGNOSTICS_EVENT,
  type OpenDiagnosticsOptions,
} from "./open-diagnostics";

const DiagnosticsView = lazy(() =>
  import("./DiagnosticsView").then((m) => ({ default: m.DiagnosticsView })),
);

/**
 * Draws the diagnostics page over the whole window. Core mounts it at the
 * root, so it opens from the login page, the loading screen or a broken
 * layout, and keeps what this page recorded so far.
 */
export function DiagnosticsHost() {
  const [open, setOpen] = useState<OpenDiagnosticsOptions | null>(() =>
    diagnosticsRequested() ? {} : null,
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenDiagnosticsOptions | undefined>)
        .detail;
      setOpen({
        pluginId:
          typeof detail?.pluginId === "string" ? detail.pluginId : undefined,
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isDiagnosticsShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => current ?? {});
    };
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  if (!open) return null;

  const close = () => {
    // The ?diagnostics page has no app behind it, so closing loads it.
    if (diagnosticsRequested()) {
      const url = new URL(window.location.href);
      url.searchParams.delete("diagnostics");
      window.location.replace(url.toString());
      return;
    }
    setOpen(null);
  };

  return (
    <div
      data-diagnostics-view=""
      className="fixed inset-0 z-[1000] flex flex-col bg-background"
    >
      <Suspense fallback={<LoadingState className="h-full" />}>
        <DiagnosticsView
          key={open.pluginId ?? ""}
          focusPluginId={open.pluginId}
          onClose={close}
        />
      </Suspense>
    </div>
  );
}
