import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/button";
import { Select2 } from "@/components/select2";
import { InlineView, useConfirm } from "@/components/surface/surface-scope";
import {
  deleteCredential,
  deployCredentialToHost,
  duplicateCredential,
  getCredentials,
  getSSHHosts,
  renameCredentialFolder,
  updateCredential,
} from "@/main-axios";
import { requestManage } from "@/manage/manage-requests";
import type { Credential, Host } from "@/types/ui-types";
import type {
  CredentialRowFields,
  CredentialSidebarFilterState,
  CredentialSortKey,
} from "@/types/credential-sidebar-preferences";
import { CredentialShareModal } from "./CredentialShareModal";
import { CredentialSidebarTree } from "./credential-tree";
import { credentialPassesFilters, sortCredentials } from "./credential-sort";
import { enabledHostProtocols } from "./host-protocols";
import { mapCredentials, sshHostToHost } from "./HostManagerData";

const UNCATEGORIZED = "Uncategorized";

/**
 * The credentials sidebar list. Editing happens in the Manage tab; this keeps
 * the tree, its folder moves and the quick actions on each row.
 */
export function CredentialList({
  search = "",
  sort = "default",
  arrangeLocked = true,
  filter,
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
  rowFields,
  onTagsChange,
}: {
  search?: string;
  sort?: CredentialSortKey;
  arrangeLocked?: boolean;
  filter?: CredentialSidebarFilterState;
  density?: "comfortable" | "compact";
  trayTrigger?: "always" | "hover" | "click" | "actionsOnly";
  showTags?: boolean;
  rowFields?: CredentialRowFields;
  onTagsChange?: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareCredential, setShareCredential] = useState<Credential | null>(
    null,
  );
  const [deployTarget, setDeployTarget] = useState<Credential | null>(null);
  const [deployHostId, setDeployHostId] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [editingFolderName, setEditingFolderName] = useState<string | null>(
    null,
  );
  const [editingFolderValue, setEditingFolderValue] = useState("");

  useEffect(() => {
    onTagsChange?.([...new Set(credentials.flatMap((c) => c.tags ?? []))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  useEffect(() => {
    const reloadHosts = () => {
      getSSHHosts()
        .then((raw) => setHosts(raw.map(sshHostToHost)))
        .catch(() => {});
    };
    const reloadCredentials = () => {
      getCredentials()
        .then((res) => setCredentials(mapCredentials(res)))
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    reloadHosts();
    reloadCredentials();
    window.addEventListener("termix:hosts-changed", reloadHosts);
    window.addEventListener("ssh-hosts:changed", reloadHosts);
    window.addEventListener("termix:credentials-changed", reloadCredentials);
    return () => {
      window.removeEventListener("termix:hosts-changed", reloadHosts);
      window.removeEventListener("ssh-hosts:changed", reloadHosts);
      window.removeEventListener(
        "termix:credentials-changed",
        reloadCredentials,
      );
    };
  }, []);

  const needle = search.toLowerCase();
  const searched = credentials.filter(
    (c) =>
      c.name.toLowerCase().includes(needle) ||
      c.username.toLowerCase().includes(needle),
  );
  const filtered = sortCredentials(
    filter
      ? searched.filter((c) => credentialPassesFilters(c, filter))
      : searched,
    sort,
  );
  const folderNames = Array.from(
    new Set(filtered.map((c) => c.folder || UNCATEGORIZED)),
  ).sort();
  const folderTree = folderNames.map((name) => ({
    name,
    children: filtered.filter((c) => (c.folder || UNCATEGORIZED) === name),
  }));
  const usedByCounts = new Map<string, number>();
  for (const cred of filtered) {
    usedByCounts.set(
      cred.id,
      hosts.filter((h) => h.credentialId === cred.id).length,
    );
  }

  const reload = async () => {
    const res = await getCredentials();
    setCredentials(mapCredentials(res));
  };

  const renameFolder = async (folder: string, newName: string) => {
    try {
      await renameCredentialFolder(folder, newName);
      await reload();
      toast.success(t("credentials.folderRenamedTo", { name: newName }));
    } catch {
      toast.error(t("credentials.failedToRenameFolder"));
    }
  };

  const moveToFolder = async (credentialId: string, targetFolder: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (!cred || (cred.folder || UNCATEGORIZED) === targetFolder) return;
    const folderValue = targetFolder === UNCATEGORIZED ? "" : targetFolder;
    try {
      await updateCredential(Number(credentialId), { folder: folderValue });
      setCredentials((prev) =>
        prev.map((c) =>
          c.id === credentialId ? { ...c, folder: folderValue } : c,
        ),
      );
    } catch {
      toast.error(t("credentials.failedToMoveCredential"));
    }
  };

  const clone = async (cred: Credential) => {
    try {
      await duplicateCredential(Number(cred.id), {
        name: t("credentials.clonedCredentialName", { name: cred.name }),
      });
      await reload();
      window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
      toast.success(t("credentials.clonedCredential", { name: cred.name }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      toast.error(msg || t("credentials.failedToCloneCredential"));
    }
  };

  const remove = async (cred: Credential) => {
    const ok = await confirm({
      title: t("credentials.deleteCredentialConfirm", { name: cred.name }),
      description: t("manage.cannotBeUndone"),
    });
    if (!ok) return;
    try {
      await deleteCredential(Number(cred.id));
      setCredentials((prev) => prev.filter((c) => c.id !== cred.id));
      window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
      toast.success(t("credentials.deletedCredential", { name: cred.name }));
    } catch {
      toast.error(t("credentials.failedToDeleteCredential"));
    }
  };

  const deploy = async () => {
    if (!deployTarget || !deployHostId) return;
    setDeploying(true);
    try {
      await deployCredentialToHost(
        Number(deployTarget.id),
        Number(deployHostId),
      );
      toast.success(t("credentials.keyDeployedSuccess"));
      setDeployTarget(null);
    } catch {
      toast.error(t("credentials.failedToDeployKey"));
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {!loading && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <span className="text-sm font-semibold text-muted-foreground/60">
            {t("credentials.noCredentialsFound")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-7 border-accent-brand/40 text-xs text-accent-brand hover:bg-accent-brand/10"
            onClick={() =>
              requestManage({ kind: "credential", credentialId: null })
            }
          >
            {t("credentials.addCredentialBtn")}
          </Button>
        </div>
      ) : (
        <CredentialSidebarTree
          folders={folderTree}
          usedByCounts={usedByCounts}
          query=""
          loading={loading}
          arrangeLocked={arrangeLocked}
          density={density}
          trayTrigger={trayTrigger}
          showTags={showTags}
          rowFields={rowFields}
          editingFolderName={editingFolderName}
          editingFolderValue={editingFolderValue}
          onEditingFolderNameChange={setEditingFolderName}
          onEditingFolderValueChange={setEditingFolderValue}
          onRenameFolder={renameFolder}
          onMoveCredentialToFolder={moveToFolder}
          onDeployCredential={(cred) => {
            setDeployHostId("");
            setDeployTarget(cred);
          }}
          onEditCredential={(cred) =>
            requestManage({ kind: "credential", credentialId: cred.id })
          }
          onCloneCredential={clone}
          onDeleteCredential={remove}
          onShareCredential={setShareCredential}
        />
      )}

      <CredentialShareModal
        credential={shareCredential}
        onClose={() => setShareCredential(null)}
      />

      <InlineView
        open={!!deployTarget}
        onOpenChange={(open) => {
          if (!open) setDeployTarget(null);
        }}
        icon={<Upload className="size-4" />}
        title={t("credentials.deployDialogTitle")}
        footer={
          <div className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeployTarget(null)}
              disabled={deploying}
            >
              {t("hosts.cancelBtn")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
              disabled={!deployHostId || deploying}
              onClick={() => void deploy()}
            >
              {deploying
                ? t("credentials.deployingBtn")
                : t("credentials.deployBtn")}
            </Button>
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          {t("credentials.deployDialogDesc", { name: deployTarget?.name })}
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("credentials.targetHostLabel")}
          </label>
          <Select2
            className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            value={deployHostId}
            onChange={(e) => setDeployHostId(e.target.value)}
          >
            <option value="">{t("credentials.selectHostOption")}</option>
            {hosts
              .filter(
                (h) => h.enableSsh || enabledHostProtocols(h).length === 0,
              )
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name || h.ip}
                </option>
              ))}
          </Select2>
        </div>
      </InlineView>
    </div>
  );
}
