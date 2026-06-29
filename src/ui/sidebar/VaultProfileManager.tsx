import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  createVaultProfile,
  updateVaultProfile,
  deleteVaultProfile,
  type VaultProfilePayload,
} from "@/main-axios";
import type { VaultProfile } from "@/types/ui-types";

type FormState = VaultProfilePayload & { id?: string };

const emptyForm: FormState = {
  name: "",
  vaultAddr: "",
  vaultNamespace: "",
  oidcMount: "oidc",
  oidcRole: "",
  sshMount: "ssh-client-signer",
  sshRole: "",
  validPrincipals: "",
  keyType: "ssh-ed25519",
  shared: false,
};

function toForm(p: VaultProfile): FormState {
  return {
    id: p.id,
    name: p.name,
    vaultAddr: p.vaultAddr,
    vaultNamespace: p.vaultNamespace ?? "",
    oidcMount: p.oidcMount ?? "oidc",
    oidcRole: p.oidcRole ?? "",
    sshMount: p.sshMount ?? "ssh-client-signer",
    sshRole: p.sshRole,
    validPrincipals: p.validPrincipals ?? "",
    keyType: p.keyType ?? "ssh-ed25519",
    shared: p.shared,
  };
}

export function VaultProfileManager({
  profiles,
  onChanged,
  onClose,
}: {
  profiles: VaultProfile[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.vaultAddr.trim() || !form.sshRole.trim()) {
      toast.error(t("hosts.vaultProfileValidationError"));
      return;
    }
    setSaving(true);
    try {
      const payload: VaultProfilePayload = {
        name: form.name.trim(),
        vaultAddr: form.vaultAddr.trim(),
        vaultNamespace: form.vaultNamespace?.trim() || null,
        oidcMount: form.oidcMount?.trim() || null,
        oidcRole: form.oidcRole?.trim() || null,
        sshMount: form.sshMount?.trim() || null,
        sshRole: form.sshRole.trim(),
        validPrincipals: form.validPrincipals?.trim() || null,
        keyType: form.keyType?.trim() || null,
        shared: !!form.shared,
      };
      if (form.id) {
        await updateVaultProfile(Number(form.id), payload);
        toast.success(t("hosts.vaultProfileSaved"));
      } else {
        await createVaultProfile(payload);
        toast.success(t("hosts.vaultProfileCreated"));
      }
      setForm(null);
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("hosts.vaultProfileSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: VaultProfile) => {
    try {
      await deleteVaultProfile(Number(p.id));
      toast.success(t("hosts.vaultProfileDeleted"));
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("hosts.vaultProfileDeleteFailed"),
      );
    }
  };

  const field = (label: string, key: keyof FormState, placeholder?: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      <Input
        className="h-8 text-xs"
        placeholder={placeholder}
        value={(form?.[key] as string) ?? ""}
        onChange={(e) => setField(key, e.target.value as FormState[typeof key])}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3 col-span-2 border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("hosts.vaultManageProfiles")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {!form && (
        <>
          <div className="flex flex-col divide-y divide-border/50">
            {profiles.length === 0 && (
              <span className="text-[11px] text-muted-foreground py-1">
                {t("hosts.vaultNoProfiles")}
              </span>
            )}
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-foreground truncate">
                    {p.name}
                    {p.shared && (
                      <span className="ml-1 text-[9px] text-accent-brand">
                        {t("hosts.vaultSharedBadge")}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {p.vaultAddr}
                  </span>
                </div>
                {p.owned && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => setForm(toForm(p))}
                      className="size-7 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted-foreground/10"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => handleDelete(p)}
                      className="size-7 flex items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] self-start"
            onClick={() => setForm({ ...emptyForm })}
          >
            <Plus className="size-3 mr-1" /> {t("hosts.vaultNewProfile")}
          </Button>
        </>
      )}

      {form && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field(t("hosts.friendlyNameLabel"), "name", "Production Vault")}
            {field(
              t("hosts.vaultAddrLabel"),
              "vaultAddr",
              "https://vault:8200",
            )}
            {field(t("hosts.vaultNamespaceLabel"), "vaultNamespace", "admin")}
            {field(t("hosts.vaultOidcMountLabel"), "oidcMount", "oidc")}
            {field(t("hosts.vaultOidcRoleLabel"), "oidcRole", "default")}
            {field(
              t("hosts.vaultSshMountLabel"),
              "sshMount",
              "ssh-client-signer",
            )}
            {field(t("hosts.vaultSshRoleLabel"), "sshRole", "my-role")}
            {field(
              t("hosts.vaultValidPrincipalsLabel"),
              "validPrincipals",
              "root,deploy",
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.vaultKeyTypeLabel")}
            </label>
            <select
              value={form.keyType ?? "ssh-ed25519"}
              onChange={(e) => setField("keyType", e.target.value)}
              className="flex h-8 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ssh-ed25519">Ed25519</option>
              <option value="ecdsa-sha2-nistp256">ECDSA (nistp256)</option>
              <option value="ssh-rsa">RSA (4096)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!form.shared}
              onChange={(e) => setField("shared", e.target.checked)}
            />
            {t("hosts.vaultSharedLabel")}
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setForm(null)}
              disabled={saving}
            >
              {t("hosts.cancelBtn")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-accent-brand/40 text-accent-brand"
              onClick={handleSave}
              disabled={saving}
            >
              {form.id
                ? t("hosts.vaultSaveProfile")
                : t("hosts.vaultCreateProfile")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
