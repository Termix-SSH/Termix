import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Copy,
  FolderOpen,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
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

function CredentialItem({
  cred,
  usedByCount,
  stripeIndex,
  onDeploy,
  onEdit,
  onDelete,
}: {
  cred: Credential;
  usedByCount: number;
  stripeIndex: number;
  onDeploy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isKey = cred.type === "key";

  return (
    <div
      className={`group relative flex items-stretch cursor-default select-none transition-colors hover:bg-muted/40 ${stripeIndex % 2 === 1 ? "bg-muted/20" : ""}`}
    >
      {/* Type stripe */}
      <div className="w-[3px] shrink-0 bg-transparent" />

      <div className="flex flex-col flex-1 min-w-0 px-2.5 pt-2 pb-1.5 gap-1">
        {/* Name row */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-medium truncate text-foreground leading-none">
            {cred.name}
          </span>
          <span
            className={`text-[9px] px-1 py-px font-bold border leading-none shrink-0 ${isKey ? "border-accent-brand/30 text-accent-brand" : "border-border/60 text-muted-foreground/60"}`}
          >
            {isKey ? "KEY" : "PWD"}
          </span>
        </div>

        {/* Username row */}
        {(cred.username || usedByCount > 0) && (
          <span className="text-[11px] text-muted-foreground/45 truncate leading-none pl-3">
            {cred.username}
            {usedByCount > 0 && (
              <span className="text-muted-foreground/30">
                {cred.username ? " · " : ""}
                {usedByCount}h
              </span>
            )}
          </span>
        )}

        {/* Tag pills */}
        {cred.tags && cred.tags.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden pl-3">
            {cred.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1 py-px border border-border/50 bg-muted/30 text-muted-foreground/60 lowercase shrink-0 leading-none"
              >
                {tag}
              </span>
            ))}
            {cred.tags.length > 4 && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                +{cred.tags.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Action tray — slides open on hover */}
        <div className="overflow-hidden transition-all duration-150 ease-out max-h-0 opacity-0 group-hover:max-h-[60px] group-hover:opacity-100">
          <div className="flex items-center gap-1 pt-1.5 pl-2 pb-1 border-t border-border/40 mt-0.5">
            {isKey && (
              <>
                <button
                  title="Deploy key to host"
                  onClick={onDeploy}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Upload className="size-3.5" />
                </button>
                <button
                  title="Copy deploy command"
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
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Copy className="size-3.5" />
                </button>
              </>
            )}
            <button
              title="Edit credential"
              onClick={onEdit}
              className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              title="Delete credential"
              onClick={onDelete}
              className="flex items-center justify-center size-7 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialFolderItem({
  folder,
  creds,
  allHosts,
  stripeOffset,
  editingFolderName,
  editingFolderValue,
  onEditingFolderNameChange,
  onEditingFolderValueChange,
  onRenameFolder,
  onDeploy,
  onEdit,
  onDelete,
}: {
  folder: string;
  creds: Credential[];
  allHosts: Host[];
  stripeOffset: number;
  editingFolderName: string | null;
  editingFolderValue: string;
  onEditingFolderNameChange: (name: string | null) => void;
  onEditingFolderValueChange: (value: string) => void;
  onRenameFolder: (folder: string, newName: string) => Promise<void>;
  onDeploy: (cred: Credential) => void;
  onEdit: (cred: Credential) => void;
  onDelete: (cred: Credential) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`group/folder flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors text-left cursor-pointer ${stripeOffset % 2 === 1 ? "bg-muted/20" : ""}`}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <FolderOpen
          className={`size-3.5 shrink-0 ${open ? "text-accent-brand" : "text-muted-foreground/60"}`}
        />
        {editingFolderName === folder ? (
          <>
            <input
              autoFocus
              value={editingFolderValue}
              onChange={(e) => onEditingFolderValueChange(e.target.value)}
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
              onClick={(e) => {
                e.stopPropagation();
                onEditingFolderNameChange(null);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-3" />
            </button>
          </>
        ) : (
          <>
            <span className="text-[13px] font-semibold text-foreground/80 truncate flex-1">
              {folder}
            </span>
            <span className="text-[10px] tabular-nums shrink-0 ml-1 text-muted-foreground/40">
              {creds.length}
            </span>
            {folder !== "Uncategorized" && (
              <span
                className="opacity-0 group-hover/folder:opacity-100 transition-opacity ml-1 text-muted-foreground/50 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditingFolderNameChange(folder);
                  onEditingFolderValueChange(folder);
                }}
              >
                <Pencil className="size-2.5" />
              </span>
            )}
          </>
        )}
      </button>
      {open && (
        <div className="border-l border-border/40 ml-[30px]">
          {creds.map((cred, i) => {
            const usedByCount = allHosts.filter(
              (h) => h.credentialId === cred.id,
            ).length;
            return (
              <CredentialItem
                key={cred.id}
                cred={cred}
                usedByCount={usedByCount}
                stripeIndex={stripeOffset + 1 + i}
                onDeploy={() => onDeploy(cred)}
                onEdit={() => onEdit(cred)}
                onDelete={() => onDelete(cred)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

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

  async function handleDelete(cred: Credential) {
    onConfirmDialogChange({
      message: t("hosts.deleteCredentialConfirm", { name: cred.name }),
      onConfirm: async () => {
        try {
          await onDeleteCredential(cred);
          toast.success(t("hosts.deletedCredential", { name: cred.name }));
        } catch {
          toast.error(t("hosts.failedToDeleteCredential2"));
        }
      },
    });
  }

  async function handleEdit(cred: Credential) {
    try {
      const full = await getCredentialDetails(Number(cred.id));
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
        publicKey:
          (full as CredentialWithCertificate).certPublicKey ?? cred.publicKey,
      });
    } catch {
      onEditCredential(cred);
    }
  }

  let globalStripe = 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col">
        {credentialFolders.map((folder) => {
          const creds = filteredCredentials.filter(
            (c) => (c.folder || "Uncategorized") === folder,
          );
          if (creds.length === 0) return null;
          const offset = globalStripe;
          globalStripe += 1 + creds.length;
          return (
            <CredentialFolderItem
              key={folder}
              folder={folder}
              creds={creds}
              allHosts={allHosts}
              stripeOffset={offset}
              editingFolderName={editingFolderName}
              editingFolderValue={editingFolderValue}
              onEditingFolderNameChange={onEditingFolderNameChange}
              onEditingFolderValueChange={onEditingFolderValueChange}
              onRenameFolder={onRenameFolder}
              onDeploy={onDeployCredential}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
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
}
