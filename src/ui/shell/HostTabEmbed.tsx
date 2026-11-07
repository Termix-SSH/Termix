import { useMemo } from "react";
import type { Host, Tab } from "@/types/ui-types";
import type { TabShellCallbacks } from "@/shell/tab-registry";
import { renderTabContent } from "@/shell/tabUtils";

/**
 * Draws a registered tab type inside another view, such as a host page, with
 * the same props the tab stage gives it. The embed has its own instance id, so
 * it never collides with the same tool opened as a normal tab.
 */
export function HostTabEmbed({
  host,
  type,
  label,
  data,
  isVisible = true,
  shell,
}: {
  host: Host;
  type: string;
  label?: string;
  data?: Record<string, unknown>;
  isVisible?: boolean;
  shell: TabShellCallbacks;
}) {
  const tab = useMemo<Tab>(
    () => ({
      id: `embed-${type}-${host.id}`,
      instanceId: `embed-${type}-${host.id}`,
      type,
      label: label ?? host.name ?? host.ip,
      host,
      openedAt: Date.now(),
      data,
    }),
    // A new host or tool is a new tab; label and data changes keep it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, host.id],
  );
  return (
    <div className="h-full min-h-0 flex flex-col">
      {renderTabContent(tab, { shell, isVisible, isFocusedPane: isVisible })}
    </div>
  );
}
