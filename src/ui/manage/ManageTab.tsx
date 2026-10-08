import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, LibraryBig, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { HostDraft } from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { FakeSwitch } from "@/components/section-card";
import { BackButton, PanelShell } from "@/components/panel-layout";
import { useConfirm } from "@/components/surface/surface-scope";
import { useUiPreference } from "@/contexts/UiPreferencesContext";
import { usePermissions } from "@/hooks/use-permissions";
import { useServerStatus } from "@/lib/ServerStatusContext";
import {
  deleteCredential,
  deleteSSHHost,
  getCredentialDetails,
  getCredentials,
  getSSHHosts,
  type SSHHostWithStatus,
} from "@/main-axios";
import { getFolderDefaultsId } from "@/api/host-defaults-api";
import { invalidateHostsAndStatusCaches } from "@/lib/hosts-request-cache";
import { registerTabCloseGuard } from "@/shell/tab-close-guards";
import { HostEditor } from "@/sidebar/HostEditor";
import { CredentialEditorView } from "@/sidebar/CredentialEditorView";
import {
  HostDefaultsEditorView,
  hostDefaultsTitle,
  type HostDefaultsEditorTarget,
} from "@/sidebar/host-defaults/HostDefaultsEditorView";
import { mapCredentials, sshHostToHost } from "@/sidebar/HostManagerData";
import {
  hostProtocolFlags,
  type HostProtocols,
} from "@/sidebar/host-protocols";
import { canDeleteHost } from "@/sidebar/host-permissions";
import type { Credential, Host } from "@/types/ui-types";
import { ManageList } from "./ManageList";
import type { DefaultsRow } from "./defaults-rows";
import {
  MANAGE_REQUEST_EVENT,
  takePendingManageRequest,
  type ManageMode,
  type ManageRequest,
} from "./manage-requests";
import { docsUrl } from "@/lib/docs";

type Editing =
  | {
      kind: "host";
      host: Host | null;
      draft?: HostDraft;
      key: number;
      protocols: HostProtocols;
    }
  | { kind: "credential"; credential: Credential | null; key: number }
  | { kind: "defaults"; target: HostDefaultsEditorTarget; rowKey: string };

const TAB_ID = "host-manager";

/** Fetches a credential with its secrets marked as stored, for the editor. */
async function loadCredentialForEdit(cred: Credential): Promise<Credential> {
  try {
    const full = (await getCredentialDetails(Number(cred.id))) as {
      hasKey?: boolean;
      hasKeyPassword?: boolean;
      password?: string;
      certPublicKey?: string;
    };
    return {
      ...cred,
      value: full.hasKey ? "existing_key" : (full.password ?? ""),
      password: full.password ?? "",
      passphrase: full.hasKeyPassword ? "existing_key_password" : "",
      publicKey: full.certPublicKey ?? cred.publicKey,
    };
  } catch {
    return cred;
  }
}

/**
 * Hosts, credentials and host defaults, edited at full width: a list on the
 * left, the thing you picked on the right.
 */
export function ManageTab() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { has } = usePermissions();
  const { statuses } = useServerStatus();
  const presetMode = useUiPreference("hostEditor", "mode");

  const [mode, setMode] = useState<ManageMode>("hosts");
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  // Starts from the preset and stays where the user puts it this session.
  const [advanced, setAdvanced] = useState(presetMode !== "simple");
  // The host a credential was opened from, so Back returns to it.
  const [returnHost, setReturnHost] = useState<Host | "new" | null>(null);

  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const reloadHosts = useCallback(() => {
    return getSSHHosts()
      .then((raw) => {
        const list = raw.map(sshHostToHost);
        hostsRef.current = list;
        setHosts(list);
      })
      .catch(() => {});
  }, []);
  const reloadCredentials = useCallback(() => {
    return getCredentials()
      .then((res) => {
        const list = mapCredentials(res);
        credentialsRef.current = list;
        setCredentials(list);
      })
      .catch(() => {});
  }, []);

  const loaded = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    loaded.current = Promise.all([reloadHosts(), reloadCredentials()]);
  }, [reloadHosts, reloadCredentials]);

  useEffect(() => {
    window.addEventListener("termix:hosts-changed", reloadHosts);
    window.addEventListener("ssh-hosts:changed", reloadHosts);
    window.addEventListener("hosts:refresh", reloadHosts);
    window.addEventListener("termix:credentials-changed", reloadCredentials);
    return () => {
      window.removeEventListener("termix:hosts-changed", reloadHosts);
      window.removeEventListener("ssh-hosts:changed", reloadHosts);
      window.removeEventListener("hosts:refresh", reloadHosts);
      window.removeEventListener(
        "termix:credentials-changed",
        reloadCredentials,
      );
    };
  }, [reloadHosts, reloadCredentials]);

  /** Asks before throwing away unsaved changes. True means go ahead. */
  const confirmDiscard = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return confirm({
      title: t("common.unsavedChanges"),
      description: t("hosts.unsavedChangesDescription"),
      confirmLabel: t("hosts.discardChanges"),
      cancelLabel: t("hosts.keepEditing"),
    });
  }, [confirm, t]);

  useEffect(
    () => registerTabCloseGuard(TAB_ID, confirmDiscard),
    [confirmDiscard],
  );

  const openHost = useCallback((host: Host | null, draft?: HostDraft) => {
    setMode("hosts");
    setReturnHost(null);
    setDirty(false);
    setEditing({
      kind: "host",
      host,
      draft,
      key: Date.now(),
      protocols: hostProtocolFlags(host),
    });
  }, []);

  const openCredential = useCallback(async (credential: Credential | null) => {
    setMode("credentials");
    setDirty(false);
    const full = credential ? await loadCredentialForEdit(credential) : null;
    setEditing({ kind: "credential", credential: full, key: Date.now() });
  }, []);

  const openDefaults = useCallback(
    async (row: Pick<DefaultsRow, "level" | "folderName">) => {
      setMode("defaults");
      setReturnHost(null);
      setDirty(false);
      const rowKey =
        row.level === "folder" ? `folder:${row.folderName}` : row.level;
      if (row.level === "folder" && row.folderName) {
        try {
          const folderId = await getFolderDefaultsId(row.folderName);
          setEditing({
            kind: "defaults",
            rowKey,
            target: { level: "folder", folderId, folderName: row.folderName },
          });
        } catch {
          toast.error(t("hostDefaults.loadFailed"));
        }
        return;
      }
      setEditing({ kind: "defaults", rowKey, target: { level: row.level } });
    },
    [t],
  );

  const apply = useCallback(
    async (request: ManageRequest | null) => {
      if (!request) return;
      if (!(await confirmDiscard())) return;
      await loaded.current;
      if (request.kind === "host") {
        const find = () =>
          hostsRef.current.find((h) => h.id === request.hostId) ?? null;
        let host = request.hostId ? find() : null;
        // Our list can lag the sidebar's, so refetch once before giving up.
        if (request.hostId && !host) {
          invalidateHostsAndStatusCaches();
          await reloadHosts();
          host = find();
          if (!host) {
            toast.error(t("manage.hostNotFound"));
            return;
          }
        }
        openHost(host, request.draft);
      } else if (request.kind === "credential") {
        const find = () =>
          credentialsRef.current.find(
            (c) => String(c.id) === String(request.credentialId),
          ) ?? null;
        let credential = request.credentialId ? find() : null;
        if (request.credentialId && !credential) {
          await reloadCredentials();
          credential = find();
        }
        void openCredential(credential);
      } else if (request.kind === "defaults") {
        void openDefaults(request);
      } else {
        setDirty(false);
        setEditing(null);
        setMode(request.mode);
      }
    },
    [
      confirmDiscard,
      openHost,
      openCredential,
      openDefaults,
      reloadHosts,
      reloadCredentials,
      t,
    ],
  );

  // The request that opened this tab was parked before it mounted.
  useEffect(() => {
    void apply(takePendingManageRequest());
    const onRequest = () => void apply(takePendingManageRequest());
    window.addEventListener(MANAGE_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(MANAGE_REQUEST_EVENT, onRequest);
  }, [apply]);

  const guarded =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    async (...args: A) => {
      if (await confirmDiscard()) fn(...args);
    };

  const close = () => {
    setDirty(false);
    setEditing(null);
  };

  const backFromCredential = () => {
    if (returnHost) {
      const host = returnHost;
      setReturnHost(null);
      openHost(host === "new" ? null : host);
      return;
    }
    close();
  };

  const editCredentialFromHost = async (credentialId: string) => {
    const cred = credentials.find((c) => String(c.id) === String(credentialId));
    if (!cred || editing?.kind !== "host") return;
    if (!(await confirmDiscard())) return;
    setReturnHost(editing.host ?? "new");
    await openCredential(cred);
  };

  const deleteCurrent = async () => {
    if (editing?.kind === "host" && editing.host) {
      const host = editing.host;
      const ok = await confirm({
        title: t("hosts.deleteHostConfirm", { name: host.name || host.ip }),
        description: t("manage.cannotBeUndone"),
      });
      if (!ok) return;
      try {
        await deleteSSHHost(Number(host.id));
        window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
        toast.success(t("hosts.deletedCount", { count: 1 }));
        close();
      } catch {
        toast.error(t("hosts.failedToDeleteCount", { count: 1 }));
      }
    } else if (editing?.kind === "credential" && editing.credential) {
      const cred = editing.credential;
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
        close();
      } catch {
        toast.error(t("credentials.failedToDeleteCredential"));
      }
    }
  };

  const isOnline = useCallback(
    (host: Host) => statuses.get(Number(host.id))?.status === "online",
    [statuses],
  );

  const existingFolders = useMemo(
    () =>
      [
        ...new Set(
          credentials.map((c) => c.folder).filter((f): f is string => !!f),
        ),
      ].sort(),
    [credentials],
  );

  const selectedKey = !editing
    ? null
    : editing.kind === "host"
      ? editing.host
        ? `h:${editing.host.id}`
        : null
      : editing.kind === "credential"
        ? editing.credential
          ? `c:${editing.credential.id}`
          : null
        : editing.rowKey;

  const status = !editing
    ? mode === "hosts"
      ? t("manage.hostCount", { count: hosts.length })
      : mode === "credentials"
        ? t("manage.credentialCount", { count: credentials.length })
        : t("manage.defaults")
    : editing.kind === "host"
      ? editing.host
        ? editing.host.name || editing.host.ip
        : t("manage.newHost")
      : editing.kind === "credential"
        ? editing.credential
          ? editing.credential.name
          : t("manage.newCredential")
        : hostDefaultsTitle(editing.target, t);

  const canDelete =
    (editing?.kind === "host" &&
      !!editing.host &&
      canDeleteHost(editing.host)) ||
    (editing?.kind === "credential" && !!editing.credential);

  const renderEditor = () => {
    if (!editing) return null;
    if (editing.kind === "defaults") {
      return (
        <HostDefaultsEditorView
          key={editing.rowKey}
          target={editing.target}
          onClose={guarded(close)}
          onDirtyChange={setDirty}
          hosts={hosts}
          credentials={credentials}
        />
      );
    }
    if (editing.kind === "credential") {
      return (
        <CredentialEditorView
          key={`c:${editing.credential?.id ?? "new"}:${editing.key}`}
          credential={editing.credential}
          existingFolders={existingFolders}
          saveAsNewHost={returnHost ?? undefined}
          onBack={backFromCredential}
          onSave={(saved, options) => {
            const id = String((saved as { id: number | string }).id);
            void reloadCredentials();
            if (options?.assignToHost && returnHost) {
              const host = returnHost;
              setReturnHost(null);
              setDirty(false);
              setMode("hosts");
              const next =
                host === "new" ? null : { ...host, credentialId: id };
              setEditing({
                kind: "host",
                host: next,
                key: Date.now(),
                protocols: hostProtocolFlags(next),
              });
              return;
            }
            if (returnHost) {
              backFromCredential();
              return;
            }
            close();
          }}
        />
      );
    }
    return (
      <HostEditor
        key={`h:${editing.host?.id ?? "new"}:${editing.key}`}
        host={editing.host}
        draft={editing.host ? undefined : editing.draft}
        advanced={advanced}
        onBack={guarded(close)}
        onSave={(saved) => {
          const updated = sshHostToHost(saved as unknown as SSHHostWithStatus);
          setHosts((prev) => {
            const idx = prev.findIndex((h) => h.id === updated.id);
            if (idx < 0) return [...prev, updated];
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
          window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
          close();
        }}
        protocols={editing.protocols}
        onProtocolChange={(p) =>
          setEditing((current) =>
            current?.kind === "host"
              ? { ...current, protocols: { ...current.protocols, ...p } }
              : current,
          )
        }
        onDirtyChange={setDirty}
        hosts={hosts}
        credentials={credentials}
        onEditCredential={(id) => void editCredentialFromHost(id)}
      />
    );
  };

  return (
    <PanelShell
      icon={<LibraryBig className="size-4" />}
      title={t("nav.manage")}
      status={status}
      scroll={false}
      docs={docsUrl(
        mode === "credentials"
          ? "credentials"
          : mode === "hosts"
            ? "hosts"
            : "hostDefaults",
      )}
      leading={
        editing ? (
          <span className="flex h-full md:hidden">
            <BackButton
              onClick={() =>
                void guarded(
                  editing.kind === "credential" ? backFromCredential : close,
                )()
              }
            />
          </span>
        ) : undefined
      }
      actions={
        <>
          {editing?.kind === "host" && (
            <label className="flex items-center gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("manage.advanced")}
              </span>
              <FakeSwitch checked={advanced} onChange={setAdvanced} />
            </label>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("common.delete")}
              aria-label={t("common.delete")}
              onClick={() => void deleteCurrent()}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <ManageList
          editing={!!editing}
          mode={mode}
          onMode={(next) =>
            void guarded(() => {
              setMode(next);
              close();
            })()
          }
          hosts={hosts}
          credentials={credentials}
          canEditInstanceDefaults={has("admin.settings.manage")}
          isOnline={isOnline}
          selectedKey={selectedKey}
          onPickHost={(host) => void guarded(() => openHost(host))()}
          onPickCredential={(cred) =>
            void guarded(() => void openCredential(cred))()
          }
          onPickDefaults={(row) => void guarded(() => void openDefaults(row))()}
          onAdd={() =>
            void guarded(() =>
              mode === "credentials"
                ? void openCredential(null)
                : openHost(null),
            )()
          }
        />

        {editing ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {renderEditor()}
          </div>
        ) : (
          <div className="hidden min-h-0 flex-1 items-center justify-center md:flex">
            <EmptyState
              icon={mode === "credentials" ? KeyRound : Server}
              title={
                mode === "hosts"
                  ? t("manage.pickHost")
                  : mode === "credentials"
                    ? t("manage.pickCredential")
                    : t("manage.pickDefaults")
              }
              hint={t("manage.pickHint")}
              action={
                mode !== "defaults" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      mode === "hosts"
                        ? openHost(null)
                        : void openCredential(null)
                    }
                  >
                    <Plus className="mr-1 size-3" />
                    {mode === "hosts"
                      ? t("hosts.addHost")
                      : t("manage.addCredential")}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
    </PanelShell>
  );
}
