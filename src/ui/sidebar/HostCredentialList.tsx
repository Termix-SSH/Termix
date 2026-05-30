import { useTranslation } from "react-i18next";
import {
  Copy,
  Folder,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/button";
import { getCredentialDetails } from "@/main-axios";
import type { Host, Credential } from "@/types/ui-types";

type CredentialWithCertificate = Credential & { certPublicKey?: string };
type ConfirmDialog = {
  message: string;
  onConfirm: () => void;
};

export function HostCredentialList({
  credentialFolders,
  filteredCredentials,
  credentialsLoading,
  allHosts,
  editingFolderName,
  editingFolderValue,
  onEditingFolderNameChange,
  onEditingFolderValueChange,
  onRenameFolder,
  onDeployCredential,
  onEditCredential,
  onDeleteCredential,
  onAddCredential,
  onConfirmDialogChange,
}: {
  credentialFolders: string[];
  filteredCredentials: Credential[];
  credentialsLoading: boolean;
  allHosts: Host[];
  editingFolderName: string | null;
  editingFolderValue: string;
  onEditingFolderNameChange: (name: string | null) => void;
  onEditingFolderValueChange: (value: string) => void;
  onRenameFolder: (folder: string, newName: string) => Promise<void>;
  onDeployCredential: (cred: Credential) => void;
  onEditCredential: (cred: Credential) => void;
  onDeleteCredential: (cred: Credential) => Promise<void>;
  onAddCredential: () => void;
  onConfirmDialogChange: (dialog: ConfirmDialog) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col">
        {credentialFolders.map((folder) => {
          const creds = filteredCredentials.filter(
            (c) => (c.folder || "Uncategorized") === folder,
          );
          if (creds.length === 0) return null;
          return (
            <div key={folder} className="group/folder">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-muted/20">
                <Folder className="size-3 text-muted-foreground/50 shrink-0" />
                {editingFolderName === folder ? (
                  <>
                    <input
                      autoFocus
                      value={editingFolderValue}
                      onChange={(e) =>
                        onEditingFolderValueChange(e.target.value)
                      }
                      onBlur={async () => {
                        const newName = editingFolderValue.trim();
                        onEditingFolderNameChange(null);
                        if (newName && newName !== folder) {
                          await onRenameFolder(folder, newName);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") onEditingFolderNameChange(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] font-semibold bg-background border border-accent-brand/60 px-1 outline-none text-foreground min-w-0 flex-1"
                    />
                    <button
                      onClick={() => onEditingFolderNameChange(null)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <X className="size-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] font-semibold text-muted-foreground/70 flex-1">
                      {folder}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {creds.length}
                    </span>
                    {folder !== "Uncategorized" && (
                      <button
                        className="opacity-0 group-hover/folder:opacity-100 transition-opacity ml-1 text-muted-foreground/50 hover:text-foreground"
                        onClick={() => {
                          onEditingFolderNameChange(folder);
                          onEditingFolderValueChange(folder);
                        }}
                      >
                        <Pencil className="size-2.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
              {creds.map((cred) => {
                const usedByHosts = allHosts.filter(
                  (h) => h.credentialId === cred.id,
                );
                return (
                  <div
                    key={cred.id}
                    className="flex items-center justify-between px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/30 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="size-7 border border-border/60 bg-muted/30 flex items-center justify-center shrink-0">
                        {cred.type === "key" ? (
                          <Shield className="size-3 text-accent-brand" />
                        ) : (
                          <Lock className="size-3 text-accent-brand" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate">
                            {cred.name}
                          </span>
                          <span
                            className={`text-[9px] px-1 py-px font-bold border leading-none shrink-0 ${cred.type === "key" ? "border-accent-brand/30 text-accent-brand" : "border-border/60 text-muted-foreground/60"}`}
                          >
                            {cred.type === "key" ? "KEY" : "PWD"}
                          </span>
                        </div>
                        {(cred.username || usedByHosts.length > 0) && (
                          <span className="text-[11px] text-muted-foreground/50 truncate">
                            {cred.username}
                            {usedByHosts.length > 0 && (
                              <span className="text-muted-foreground/30">
                                {cred.username ? " · " : ""}
                                {usedByHosts.length}h
                              </span>
                            )}
                          </span>
                        )}
                        {cred.tags && cred.tags.length > 0 && (
                          <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                            {cred.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-[9px] px-1 py-px border border-border/50 bg-muted/30 text-muted-foreground/60 lowercase leading-none"
                              >
                                {tag}
                              </span>
                            ))}
                            {cred.tags.length > 3 && (
                              <span className="text-[9px] text-muted-foreground/40">
                                +{cred.tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {cred.type === "key" && (
                        <>
                          <button
                            title="Deploy key to host"
                            className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                            onClick={() => onDeployCredential(cred)}
                          >
                            <Upload className="size-3" />
                          </button>
                          <button
                            title="Copy deploy command"
                            className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                            onClick={() => {
                              const pubKey = cred.publicKey;
                              if (!pubKey) {
                                toast.error(
                                  "No public key available — open the credential editor first",
                                );
                                return;
                              }
                              const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
                              navigator.clipboard.writeText(cmd);
                              toast.success("Deploy command copied");
                            }}
                          >
                            <Copy className="size-3" />
                          </button>
                        </>
                      )}
                      <button
                        className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors"
                        onClick={async () => {
                          try {
                            const full = await getCredentialDetails(
                              Number(cred.id),
                            );
                            onEditCredential({
                              ...cred,
                              value: (
                                full as CredentialWithCertificate & {
                                  hasKey?: boolean;
                                  hasKeyPassword?: boolean;
                                }
                              ).hasKey
                                ? "existing_key"
                                : ((
                                    full as CredentialWithCertificate & {
                                      password?: string;
                                    }
                                  ).password ?? ""),
                              passphrase: (
                                full as CredentialWithCertificate & {
                                  hasKeyPassword?: boolean;
                                }
                              ).hasKeyPassword
                                ? "existing_key_password"
                                : "",
                              certPublicKey:
                                (full as CredentialWithCertificate)
                                  .certPublicKey ?? "",
                            });
                          } catch {
                            onEditCredential(cred);
                          }
                        }}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        className="size-6 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        onClick={() => {
                          onConfirmDialogChange({
                            message: t("hosts.deleteCredentialConfirm", {
                              name: cred.name,
                            }),
                            onConfirm: async () => {
                              await onConfirmDeleteCredential(cred);
                            },
                          });
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {credentialsLoading && (
          <div className="flex flex-col px-2 py-2 space-y-1.5">
            {[60, 45, 55, 40].map((w, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <div className="size-3 rounded-sm bg-muted/50 animate-pulse shrink-0" />
                <div
                  className="h-3 rounded bg-muted/50 animate-pulse"
                  style={{ width: `${w * 2}px` }}
                />
              </div>
            ))}
            <div className="flex items-center justify-center gap-2 pt-2 text-muted-foreground/40">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-xs">{t("hosts.loadingCredentials")}</span>
            </div>
          </div>
        )}
        {!credentialsLoading && filteredCredentials.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <KeyRound className="size-8 text-muted-foreground/20 mb-2" />
            <span className="text-sm font-semibold text-muted-foreground/60">
              {t("hosts.noCredentialsFound")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
              onClick={onAddCredential}
            >
              <Plus className="size-3 mr-1" />
              {t("hosts.addCredentialBtn2")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  async function onConfirmDeleteCredential(cred: Credential) {
    try {
      await onDeleteCredential(cred);
      toast.success(t("hosts.deletedCredential", { name: cred.name }));
    } catch {
      toast.error(t("hosts.failedToDeleteCredential2"));
    }
  }
}
