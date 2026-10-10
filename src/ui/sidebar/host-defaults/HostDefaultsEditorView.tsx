/* eslint-disable react-refresh/only-export-components */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Host } from "@/types/ui-types";
import type { HostDefaultsTarget } from "@/api/host-defaults-api";
import { HostEditor } from "../HostEditor";
import { useHostEditorSections } from "../HostManagerTabs";
import { listHostProtocols, type HostProtocols } from "../host-protocols";

export interface HostDefaultsEditorTarget extends HostDefaultsTarget {
  /** The folder's path, shown as the title. */
  folderName?: string;
}

/** The title a level of defaults goes by. */
export function hostDefaultsTitle(
  target: HostDefaultsEditorTarget,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (target.level === "admin") return t("hostDefaults.titleAdmin");
  if (target.level === "user") return t("hostDefaults.titleUser");
  return t("hostDefaults.titleFolder", { name: target.folderName ?? "" });
}

/**
 * The host editor as a form for one level of host defaults: the same sections
 * and fields as a new host, minus what only one host can have (its name,
 * address, secrets, folder).
 */
export function HostDefaultsEditorView({
  target,
  onClose,
  onDirtyChange,
  hosts,
  credentials,
}: {
  target: HostDefaultsEditorTarget;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  hosts: Host[];
  credentials: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();
  useHostEditorSections();

  // Every protocol counts as on, so every section that has defaults shows.
  const protocols = useMemo<HostProtocols>(() => {
    const all: HostProtocols = { enableSsh: true };
    for (const protocol of listHostProtocols()) all[protocol.settingKey] = true;
    return all;
  }, []);

  const description =
    target.level === "admin"
      ? t("hostDefaults.descriptionAdmin")
      : target.level === "user"
        ? t("hostDefaults.descriptionUser")
        : t("hostDefaults.descriptionFolder");

  return (
    <HostEditor
      key={`${target.level}:${target.folderId ?? ""}`}
      host={null}
      banner={
        <p className="border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {description}
        </p>
      }
      onBack={onClose}
      onSave={onClose}
      protocols={protocols}
      onProtocolChange={() => {}}
      onDirtyChange={onDirtyChange}
      hosts={hosts}
      credentials={credentials}
      defaultsTarget={target}
    />
  );
}
