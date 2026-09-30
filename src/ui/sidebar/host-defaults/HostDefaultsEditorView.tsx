import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Host } from "@/types/ui-types";
import type { HostDefaultsTarget } from "@/api/host-defaults-api";
import { HostEditor } from "../HostEditor";
import {
  isSshGroupTab,
  makeHostSshSubTabs,
  makeHostTabs,
  TabStrip,
  useHostEditorSections,
} from "../HostManagerTabs";
import { listHostProtocols, type HostProtocols } from "../host-protocols";

export interface HostDefaultsEditorTarget extends HostDefaultsTarget {
  /** The folder's path, shown as the title. */
  folderName?: string;
}

/**
 * The host editor as a form for one level of host defaults: the same tabs
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
  const [activeTab, setActiveTab] = useState("general");

  // Every protocol counts as on, so every tab that has defaults shows.
  const protocols = useMemo<HostProtocols>(() => {
    const all: HostProtocols = { enableSsh: true };
    for (const protocol of listHostProtocols()) all[protocol.settingKey] = true;
    return all;
  }, []);
  const flags = protocols as unknown as Record<string, boolean>;
  const tabs = makeHostTabs(t, flags, true);
  const sshSubTabs = makeHostSshSubTabs(t, flags, true);
  const inSshGroup = isSshGroupTab(activeTab);

  const title =
    target.level === "admin"
      ? t("hostDefaults.titleAdmin")
      : target.level === "user"
        ? t("hostDefaults.titleUser")
        : t("hostDefaults.titleFolder", { name: target.folderName ?? "" });
  const description =
    target.level === "admin"
      ? t("hostDefaults.descriptionAdmin")
      : target.level === "user"
        ? t("hostDefaults.descriptionUser")
        : t("hostDefaults.descriptionFolder");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col shrink-0 border-b border-border">
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border/50"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span>{t("hosts.backToHosts")}</span>
          <span
            className="ml-auto font-semibold text-foreground truncate max-w-[220px]"
            title={title}
          >
            {title}
          </span>
        </button>
        <TabStrip
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => {
            if (id === "ssh") {
              if (!inSshGroup) setActiveTab("ssh");
            } else {
              setActiveTab(id);
            }
          }}
          isActive={(id) => (id === "ssh" ? inSshGroup : activeTab === id)}
        />
        {inSshGroup && (
          <TabStrip
            tabs={sshSubTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            variant="secondary"
          />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground border border-border bg-muted/20 px-3 py-2">
          {description}
        </p>
        <HostEditor
          key={`${target.level}:${target.folderId ?? ""}`}
          host={null}
          activeTab={activeTab}
          onBack={onClose}
          onSave={onClose}
          protocols={protocols}
          onProtocolChange={() => {}}
          onDirtyChange={onDirtyChange}
          onTabChange={setActiveTab}
          hosts={hosts}
          credentials={credentials}
          defaultsTarget={target}
        />
      </div>
    </div>
  );
}
