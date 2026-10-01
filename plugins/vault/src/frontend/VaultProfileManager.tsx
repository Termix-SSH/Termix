import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  usePermission,
  usePluginApi,
  useToast,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import { Button, Input, Select2 } from "@termix/plugin-sdk/ui";
import {
  errorMessage,
  type VaultProfile,
  type VaultProfilePayload,
} from "./types";

type FormState = {
  id?: number;
  name: string;
  vaultAddr: string;
  vaultNamespace: string;
  oidcMount: string;
  oidcRole: string;
  sshMount: string;
  sshRole: string;
  validPrincipals: string;
  keyType: string;
  shared: boolean;
};

type TextKey = Exclude<keyof FormState, "id" | "shared">;

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

const blank = (value: string) => value.trim() || null;

/** Create, edit and delete the caller's Vault profiles. */
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
  const api = usePluginApi();
  const toast = useToast();
  const canShare = usePermission("share");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.vaultAddr.trim() || !form.sshRole.trim()) {
      toast.error(t("profiles.validationError"));
      return;
    }
    setSaving(true);
    try {
      const payload: VaultProfilePayload = {
        name: form.name.trim(),
        vaultAddr: form.vaultAddr.trim(),
        vaultNamespace: blank(form.vaultNamespace),
        oidcMount: blank(form.oidcMount),
        oidcRole: blank(form.oidcRole),
        sshMount: blank(form.sshMount),
        sshRole: form.sshRole.trim(),
        validPrincipals: blank(form.validPrincipals),
        keyType: blank(form.keyType),
        shared: canShare && form.shared,
      };
      if (form.id) {
        await api.put(`/profiles/${form.id}`, payload);
        toast.success(t("profiles.saved"));
      } else {
        await api.post("/profiles", payload);
        toast.success(t("profiles.created"));
      }
      setForm(null);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, t("profiles.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profile: VaultProfile) => {
    try {
      await api.delete(`/profiles/${profile.id}`);
      toast.success(t("profiles.deleted"));
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, t("profiles.deleteFailed")));
    }
  };

  const field = (label: string, key: TextKey, placeholder?: string) => (
    <div className="flex flex-col gap-1">
      <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      <Input
        className="h-8 text-xs rounded-none"
        placeholder={placeholder}
        value={form?.[key] ?? ""}
        onChange={(e) => setField(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3 col-span-2 border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("profiles.manage")}
        </span>
        <button
          type="button"
          aria-label={t("common.close")}
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
                {t("profiles.none")}
              </span>
            )}
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-foreground truncate">
                    {profile.name}
                    {profile.shared && (
                      <span className="ml-1 text-[9px] text-accent-brand">
                        {t("profiles.sharedBadge")}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {profile.vaultAddr}
                  </span>
                </div>
                {profile.owned && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title={t("profiles.edit")}
                      onClick={() => setForm(toForm(profile))}
                      className="size-7 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted-foreground/10"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title={t("profiles.delete")}
                      onClick={() => handleDelete(profile)}
                      className="size-7 flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
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
            className="h-7 text-[10px] self-start rounded-none"
            onClick={() => setForm({ ...emptyForm })}
          >
            <Plus className="size-3 mr-1" /> {t("profiles.new")}
          </Button>
        </>
      )}

      {form && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {field(t("profiles.name"), "name", "Production Vault")}
            {field(t("profiles.vaultAddr"), "vaultAddr", "https://vault:8200")}
            {field(t("profiles.namespace"), "vaultNamespace", "admin")}
            {field(t("profiles.oidcMount"), "oidcMount", "oidc")}
            {field(t("profiles.oidcRole"), "oidcRole", "default")}
            {field(t("profiles.sshMount"), "sshMount", "ssh-client-signer")}
            {field(t("profiles.sshRole"), "sshRole", "my-role")}
            {field(
              t("profiles.validPrincipals"),
              "validPrincipals",
              "root,deploy",
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("profiles.keyType")}
            </label>
            <Select2
              value={form.keyType}
              onChange={(e) => setField("keyType", e.target.value)}
              className="flex h-8 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="ssh-ed25519">Ed25519</option>
              <option value="ecdsa-sha2-nistp256">ECDSA (nistp256)</option>
              <option value="ssh-rsa">RSA (4096)</option>
            </Select2>
          </div>
          {canShare && (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={form.shared}
                onChange={(e) => setField("shared", e.target.checked)}
              />
              {t("profiles.shareWithAll")}
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-none"
              onClick={() => setForm(null)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-none border-accent-brand/40 text-accent-brand"
              onClick={handleSave}
              disabled={saving}
            >
              {form.id ? t("profiles.save") : t("profiles.create")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
