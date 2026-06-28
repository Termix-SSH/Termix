import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy, Info, Lock, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { SectionCard } from "@/components/section-card";
import {
  createCredential,
  generateKeyPair,
  generatePublicKeyFromPrivate,
  updateCredential,
} from "@/main-axios";
import type { Credential } from "@/types/ui-types";

type CredentialWithCertificate = Credential & { certPublicKey?: string };

export function CredentialEditorView({
  credential,
  activeTab,
  onBack,
  onSave,
}: {
  credential: Credential | null;
  activeTab: string;
  onBack: () => void;
  onSave: (saved: Record<string, unknown>) => void;
}) {
  const [credForm, setCredForm] = useState(() => ({
    name: credential?.name ?? "",
    username: credential?.username ?? "",
    folder: credential?.folder ?? "",
    description: credential?.description ?? "",
    tags: credential?.tags ?? ([] as string[]),
    tagInput: "",
    type: credential?.type ?? "password",
    value: credential?.type === "key" ? (credential?.value ?? "") : "",
    password:
      credential?.type === "password"
        ? (credential?.value ?? "")
        : (credential?.password ?? ""),
    publicKey: credential?.publicKey ?? "",
    passphrase: credential?.passphrase ?? "",
    certPublicKey:
      (credential as CredentialWithCertificate | null)?.certPublicKey ?? "",
  }));
  const { t } = useTranslation();
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatingPublicKey, setGeneratingPublicKey] = useState(false);
  const credFileInputRef = useRef<HTMLInputElement>(null);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const setCredField = <K extends keyof typeof credForm>(
    k: K,
    v: (typeof credForm)[K],
  ) => setCredForm((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!credForm.name.trim()) {
      toast.error(t("hosts.credentialNameRequired"));
      return;
    }
    const hasKey =
      credForm.value === "existing_key" || credForm.value.trim() !== "";
    if (!hasKey && !credForm.password) {
      toast.error(t("hosts.credentialAuthRequired"));
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: credForm.name,
        username: credForm.username,
        folder: credForm.folder || null,
        description: credForm.description || null,
        tags: credForm.tags,
        authType: hasKey ? "key" : "password",
        password: credForm.password || null,
        key: hasKey
          ? credForm.value === "existing_key"
            ? undefined
            : credForm.value || null
          : null,
        publicKey: hasKey ? credForm.publicKey : null,
        certPublicKey: hasKey ? credForm.certPublicKey || null : null,
        keyPassword: hasKey
          ? credForm.passphrase === "existing_key_password"
            ? undefined
            : credForm.passphrase || null
          : null,
      };
      const saved = credential
        ? await updateCredential(Number(credential.id), data)
        : await createCredential(data);
      toast.success(
        credential
          ? t("hosts.credentialUpdated")
          : t("hosts.credentialCreated"),
      );
      window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
      onSave(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      toast.error(msg || t("hosts.failedToSaveCredential"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {activeTab === "general" && (
        <SectionCard
          title={t("hosts.basicInformation")}
          icon={<Info className="size-3.5" />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.friendlyNameLabel")}
              </label>
              <Input
                placeholder="e.g. Production SSH Key"
                value={credForm.name}
                onChange={(e) => setCredField("name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.folder")}
              </label>
              <Input
                placeholder="e.g. Server Keys"
                value={credForm.folder}
                onChange={(e) => setCredField("folder", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.descriptionLabel")}
              </label>
              <Input
                placeholder="Optional details..."
                value={credForm.description}
                onChange={(e) => setCredField("description", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.tags")}
              </label>
              <div className="flex flex-wrap items-center gap-1 min-h-9 px-2 py-1 border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
                {credForm.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted border border-border/60 text-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() =>
                        setCredField(
                          "tags",
                          credForm.tags.filter((tg) => tg !== tag),
                        )
                      }
                      className="text-muted-foreground hover:text-destructive ml-0.5"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  className="flex-1 min-w-16 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                  placeholder={
                    credForm.tags.length === 0
                      ? t("hosts.addTagsPlaceholder")
                      : ""
                  }
                  value={credForm.tagInput}
                  onChange={(e) => setCredField("tagInput", e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.key === " " || e.key === "Enter") &&
                      credForm.tagInput.trim()
                    ) {
                      e.preventDefault();
                      const tag = credForm.tagInput.trim();
                      if (!credForm.tags.includes(tag))
                        setCredField("tags", [...credForm.tags, tag]);
                      setCredField("tagInput", "");
                    } else if (
                      e.key === "Backspace" &&
                      !credForm.tagInput &&
                      credForm.tags.length > 0
                    ) {
                      setCredField("tags", credForm.tags.slice(0, -1));
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === "auth" && (
        <SectionCard
          title={t("hosts.authDetailsSection")}
          icon={<Lock className="size-3.5" />}
        >
          <div className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.username")}
              </label>
              <Input
                placeholder="e.g. root or deploy"
                value={credForm.username}
                onChange={(e) => setCredField("username", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.password")} ({t("common.optional")})
              </label>
              <PasswordInput
                className="h-8 text-xs pr-8"
                placeholder="••••••••"
                value={credForm.password}
                onChange={(e) => setCredField("password", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-4">
              <div className="p-3 border border-border bg-muted/20">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  {t("hosts.generateKeyPairTitle")}
                </p>
                <p className="text-[10px] text-muted-foreground mb-2">
                  {t("hosts.generateKeyPairDescription")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Ed25519", type: "ssh-ed25519" },
                    {
                      label: "ECDSA (nistp256)",
                      type: "ecdsa-sha2-nistp256",
                    },
                    { label: "RSA (2048)", type: "ssh-rsa", bits: 2048 },
                  ].map(({ label, type: keyType, bits }) => (
                    <Button
                      key={label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] px-2"
                      disabled={generatingKey}
                      onClick={async () => {
                        setGeneratingKey(true);
                        try {
                          const result = await generateKeyPair(
                            keyType as
                              | "ssh-ed25519"
                              | "ssh-rsa"
                              | "ecdsa-sha2-nistp256",
                            bits,
                            credForm.passphrase === "existing_key_password"
                              ? undefined
                              : credForm.passphrase || undefined,
                          );
                          if (result.success) {
                            setCredField("value", result.privateKey);
                            setCredField("publicKey", result.publicKey);
                            toast.success(
                              t("hosts.keyPairGenerated", { label }),
                            );
                          } else {
                            toast.error(
                              result.error ??
                                t("hosts.failedToGenerateKeyPair"),
                            );
                          }
                        } catch {
                          toast.error(t("hosts.failedToGenerateKeyPair"));
                        } finally {
                          setGeneratingKey(false);
                        }
                      }}
                    >
                      {generatingKey
                        ? t("hosts.generatingKey")
                        : t("hosts.generateLabel", { label })}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.sshPrivateKey")}
                  </label>
                  <button
                    type="button"
                    className="text-[10px] text-accent-brand hover:text-accent-brand/80 flex items-center gap-1"
                    onClick={() => credFileInputRef.current?.click()}
                  >
                    <Upload className="size-3" /> {t("hosts.uploadFileBtn")}
                  </button>
                </div>
                <input
                  ref={credFileInputRef}
                  type="file"
                  accept=".pem,.key,.ppk,.txt"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setCredField("value", text.trim());
                    e.target.value = "";
                  }}
                />
                {credForm.value === "existing_key" && (
                  <div className="px-3 py-2 text-[10px] border border-accent-brand/30 bg-accent-brand/5 text-accent-brand">
                    {t("hosts.keySaved")} — {t("hosts.keyReplaceNotice")}
                  </div>
                )}
                <textarea
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={8}
                  value={
                    credForm.value === "existing_key" ? "" : credForm.value
                  }
                  onChange={(e) => setCredField("value", e.target.value)}
                  className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.keyPassphraseOptional")}
                </label>
                <PasswordInput
                  className="h-8 text-xs pr-8"
                  placeholder={
                    credForm.passphrase === "existing_key_password"
                      ? t("hosts.keyPassphraseSaved")
                      : "••••••••"
                  }
                  value={
                    credForm.passphrase === "existing_key_password"
                      ? ""
                      : credForm.passphrase
                  }
                  onFocus={() => {
                    if (credForm.passphrase === "existing_key_password")
                      setCredField("passphrase", "");
                  }}
                  onChange={(e) => setCredField("passphrase", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.sshPublicKeyOptional")}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                    disabled={
                      !credForm.value ||
                      credForm.value === "existing_key" ||
                      generatingPublicKey
                    }
                    onClick={async () => {
                      setGeneratingPublicKey(true);
                      try {
                        const result = await generatePublicKeyFromPrivate(
                          credForm.value,
                          credForm.passphrase === "existing_key_password"
                            ? undefined
                            : credForm.passphrase || undefined,
                        );
                        if (result?.publicKey) {
                          setCredField("publicKey", result.publicKey);
                          toast.success(t("hosts.publicKeyGenerated"));
                        } else {
                          toast.error(t("hosts.failedToGeneratePublicKey"));
                        }
                      } catch {
                        toast.error(t("hosts.failedToGeneratePublicKey"));
                      } finally {
                        setGeneratingPublicKey(false);
                      }
                    }}
                  >
                    {generatingPublicKey
                      ? t("hosts.generatingKey")
                      : t("hosts.generateFromPrivateKey")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    disabled={!credForm.publicKey}
                    onClick={() => {
                      copyToClipboard(credForm.publicKey ?? "");
                      toast.success(t("hosts.publicKeyCopied"));
                    }}
                  >
                    <Copy className="size-3 mr-1" /> {t("common.copy")}
                  </Button>
                </div>
                <textarea
                  placeholder="ssh-rsa AAAAB3Nza..."
                  rows={3}
                  value={credForm.publicKey}
                  onChange={(e) => setCredField("publicKey", e.target.value)}
                  className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5 p-3 border border-border bg-muted/20">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("credentials.caCertificate")}
                  </label>
                  {credForm.certPublicKey && (
                    <button
                      type="button"
                      className="text-[10px] text-destructive hover:text-destructive/80"
                      onClick={() => setCredField("certPublicKey", "")}
                    >
                      {t("credentials.clearCert")}
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("credentials.caCertificateDescription")}
                </p>
                <button
                  type="button"
                  className="text-[10px] text-accent-brand hover:text-accent-brand/80 flex items-center gap-1 self-start"
                  onClick={() => certFileInputRef.current?.click()}
                >
                  <Upload className="size-3" />{" "}
                  {t("credentials.uploadCertFile")}
                </button>
                <input
                  ref={certFileInputRef}
                  type="file"
                  accept=".pub,.txt"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setCredField("certPublicKey", text.trim());
                    e.target.value = "";
                  }}
                />
                <textarea
                  placeholder={t("credentials.pasteOrUploadCert")}
                  rows={2}
                  value={credForm.certPublicKey}
                  onChange={(e) =>
                    setCredField("certPublicKey", e.target.value)
                  }
                  className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                />
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      <div className="flex justify-end gap-3 mt-3">
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          {t("hosts.cancelBtn")}
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? t("hosts.savingBtn")
            : credential
              ? t("hosts.updateCredentialBtn")
              : t("hosts.addCredentialBtn")}
        </Button>
      </div>
    </div>
  );
}
