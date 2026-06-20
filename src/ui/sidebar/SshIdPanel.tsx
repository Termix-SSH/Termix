import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Fingerprint,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import {
  getMySshId,
  checkSshIdHandle,
  createSshId,
  deleteSshId,
  addSshIdKey,
  generateSshIdKey,
  setSshIdKeyEnabled,
  deleteSshIdKey,
  getCredentials,
  getMyCa,
  createCa,
  rotateCa,
  deleteCa,
  issueCertificate,
  type SshIdentity,
  type SshIdentityKey,
  type SshIdCa,
} from "@/main-axios";

const accentBtn =
  "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand";

function resolverUrl(handle: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-termix";
  return `${origin}/sshid/u/${handle}`;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <div className="flex flex-col gap-1.5 py-2.5 border-b border-border last:border-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 text-[11px] font-mono bg-muted/30 border border-border/50 px-2 py-1.5 overflow-x-auto whitespace-nowrap text-muted-foreground">
          {value}
        </code>
        <Button variant="outline" size="icon-sm" onClick={copy}>
          {copied ? (
            <Check className="size-3.5 text-accent-brand" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function SshIdPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<SshIdentity | null>(null);
  const [keys, setKeys] = useState<SshIdentityKey[]>([]);
  const [ca, setCa] = useState<SshIdCa | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getMySshId();
      setIdentity(data.identity);
      setKeys(data.keys);
      if (data.identity) {
        try {
          const caData = await getMyCa();
          setCa(caData.ca);
        } catch {
          setCa(null);
        }
      } else {
        setCa(null);
      }
    } catch {
      toast.error(t("sshId.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        <Loader2 className="animate-spin size-4" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        {!identity ? (
          <ClaimHandle onCreated={refresh} />
        ) : (
          <>
            <IdentityCard identity={identity} onChanged={refresh} />
            <AddKey handle={identity.handle} onAdded={refresh} />
            <KeyList
              keys={keys}
              handle={identity.handle}
              caEnabled={!!ca}
              onChanged={refresh}
            />
            <CaCard handle={identity.handle} ca={ca} onChanged={refresh} />
          </>
        )}
      </div>
    </div>
  );
}

function ClaimHandle({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "available" | "taken" | "invalid"
  >("idle");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const h = handle.trim().toLowerCase();
    if (!h) {
      setStatus("idle");
      return;
    }
    // Guard against an out-of-order response: if the input changed (effect
    // cleanup ran) before this request resolved, ignore its result.
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await checkSshIdHandle(h);
        if (cancelled) return;
        setStatus(
          !res.valid ? "invalid" : res.available ? "available" : "taken",
        );
      } catch {
        if (!cancelled) setStatus("idle");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle]);

  async function submit() {
    setSubmitting(true);
    try {
      await createSshId(
        handle.trim().toLowerCase(),
        description.trim() || undefined,
      );
      toast.success(t("sshId.created"));
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title={t("sshId.title")}
      icon={<Fingerprint className="size-3.5" />}
    >
      <div className="flex flex-col gap-3 py-3">
        <p className="text-xs text-muted-foreground leading-snug">
          {t("sshId.claimIntro")}
        </p>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("sshId.handleLabel")}</FieldLabel>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">@</span>
            <Input
              value={handle}
              placeholder={t("sshId.handlePlaceholder")}
              autoCapitalize="none"
              spellCheck={false}
              className="h-8 text-xs"
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <span className="text-[11px] h-4 leading-4">
            {checking ? (
              <span className="text-muted-foreground">
                {t("sshId.checking")}
              </span>
            ) : status === "available" ? (
              <span className="text-accent-brand">{t("sshId.available")}</span>
            ) : status === "taken" ? (
              <span className="text-destructive">{t("sshId.taken")}</span>
            ) : status === "invalid" ? (
              <span className="text-destructive">
                {t("sshId.invalidHandle")}
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t("sshId.descriptionLabel")}</FieldLabel>
          <Input
            value={description}
            placeholder={t("sshId.descriptionPlaceholder")}
            className="h-8 text-xs"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className={`self-start ${accentBtn}`}
          disabled={status !== "available" || submitting}
          onClick={submit}
        >
          {submitting ? (
            <Loader2 className="animate-spin size-3.5" />
          ) : (
            t("sshId.create")
          )}
        </Button>
      </div>
    </SectionCard>
  );
}

function IdentityCard({
  identity,
  onChanged,
}: {
  identity: SshIdentity;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const url = resolverUrl(identity.handle);
  const curl = `curl -fsSL ${url} >> ~/.ssh/authorized_keys`;

  async function remove() {
    if (!window.confirm(t("sshId.deleteConfirm"))) return;
    try {
      await deleteSshId();
      toast.success(t("sshId.deleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.deleteFailed"));
    }
  }

  return (
    <SectionCard
      title={t("sshId.title")}
      icon={<Fingerprint className="size-3.5" />}
      action={
        <Button variant="ghost" size="icon-sm" onClick={remove}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      }
    >
      <div className="flex items-center gap-2 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-accent-brand">
          @{identity.handle}
        </span>
      </div>
      <CopyRow label={t("sshId.resolverUrlLabel")} value={url} />
      <CopyRow label={t("sshId.provisionLabel")} value={curl} />
    </SectionCard>
  );
}

interface CredentialOption {
  id: number;
  name: string;
}

function downloadText(filename: string, text: string) {
  // octet-stream so the browser/OS keeps the given extension instead of
  // appending .txt to a text/plain download.
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AddKey({ handle, onAdded }: { handle: string; onAdded: () => void }) {
  const { t } = useTranslation();
  const [publicKey, setPublicKey] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saveToVault, setSaveToVault] = useState(true);
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);

  const loadCredentials = useCallback(async () => {
    try {
      const data = await getCredentials();
      const list = Array.isArray(data) ? data : [];
      setCredentials(
        list
          .filter((c) => c.authType === "key")
          .map((c) => ({ id: Number(c.id), name: String(c.name) })),
      );
    } catch {
      // non-fatal — manual paste still works
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  async function addManual() {
    if (!publicKey.trim()) return;
    setSubmitting(true);
    try {
      await addSshIdKey({
        publicKey: publicKey.trim(),
        label: label.trim() || undefined,
      });
      toast.success(t("sshId.keyPublished"));
      setPublicKey("");
      setLabel("");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.addKeyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const result = await generateSshIdKey("ed25519", saveToVault);
      downloadText(`termix-${handle}-ed25519.key`, result.privateKey);
      toast.success(
        saveToVault ? t("sshId.generatedSaved") : t("sshId.generatedOnly"),
      );
      if (saveToVault) loadCredentials();
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.generateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function importCredential(id: number) {
    setSubmitting(true);
    try {
      await addSshIdKey({ credentialId: id });
      toast.success(t("sshId.imported"));
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.importFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title={t("sshId.publishTitle")}
      icon={<Plus className="size-3.5" />}
      action={
        <Button
          variant="outline"
          size="sm"
          className={accentBtn}
          onClick={generate}
          disabled={generating}
          title={t("sshId.generateTooltip")}
        >
          {generating ? (
            <Loader2 className="animate-spin size-3.5" />
          ) : (
            <>
              <Sparkles className="size-3.5" />
              {t("sshId.generate")}
            </>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-3">
        <SettingRow label={t("sshId.saveToVault")}>
          <FakeSwitch checked={saveToVault} onChange={setSaveToVault} />
        </SettingRow>

        <Textarea
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder={t("sshId.keyPlaceholder")}
          rows={3}
          className="font-mono text-[11px]"
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("sshId.labelPlaceholder")}
            className="h-8 text-xs flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className={accentBtn}
            onClick={addManual}
            disabled={!publicKey.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="animate-spin size-3.5" />
            ) : (
              t("sshId.add")
            )}
          </Button>
        </div>

        {credentials.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <FieldLabel>{t("sshId.importFromCredential")}</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {credentials.map((c) => (
                <Button
                  key={c.id}
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => importCredential(c.id)}
                >
                  <KeyRound className="size-3.5" />
                  {c.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function KeyList({
  keys,
  handle,
  caEnabled,
  onChanged,
}: {
  keys: SshIdentityKey[];
  handle: string;
  caEnabled: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [issuingId, setIssuingId] = useState<number | null>(null);

  async function toggle(k: SshIdentityKey) {
    try {
      await setSshIdKeyEnabled(k.id, !k.enabled);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.updateKeyFailed"));
    }
  }

  async function remove(k: SshIdentityKey) {
    try {
      await deleteSshIdKey(k.id);
      toast.success(t("sshId.keyRemoved"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.removeKeyFailed"));
    }
  }

  async function issueCert(k: SshIdentityKey) {
    setIssuingId(k.id);
    try {
      const res = await issueCertificate(k.id);
      downloadText(`termix-${handle}-${k.id}-cert.pub`, res.certificate + "\n");
      toast.success(t("sshId.certIssued"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.certIssueFailed"));
    } finally {
      setIssuingId(null);
    }
  }

  return (
    <SectionCard
      title={t("sshId.keysTitle")}
      icon={<KeyRound className="size-3.5" />}
    >
      {keys.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3">
          {t("sshId.noKeys")}
        </p>
      ) : (
        keys.map((k) => {
          const canCert = caEnabled && k.algorithm.toUpperCase() === "ED25519";
          return (
            <div
              key={k.id}
              className="flex items-center gap-2 py-2.5 border-b border-border last:border-0"
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-accent-brand border border-accent-brand/40 px-1 py-px shrink-0 leading-none">
                {k.algorithm}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {k.label || k.comment || k.keyType}
                </div>
                <code className="text-[10px] font-mono text-muted-foreground truncate block">
                  {k.publicKey}
                </code>
              </div>
              {canCert && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => issueCert(k)}
                  disabled={issuingId === k.id}
                  title={t("sshId.issueCertTooltip")}
                >
                  {issuingId === k.id ? (
                    <Loader2 className="animate-spin size-3.5" />
                  ) : (
                    <ScrollText className="size-3.5" />
                  )}
                </Button>
              )}
              <FakeSwitch checked={k.enabled} onChange={() => toggle(k)} />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(k)}
                title={t("sshId.published")}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          );
        })
      )}
    </SectionCard>
  );
}

function CaCard({
  handle,
  ca,
  onChanged,
}: {
  handle: string;
  ca: SshIdCa | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const caUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/sshid/u/${handle}/ca`
      : `/sshid/u/${handle}/ca`;
  const trustCmd = `curl -fsSL ${caUrl} | sudo tee /etc/ssh/${handle}-ca.pub && echo "TrustedUserCAKeys /etc/ssh/${handle}-ca.pub" | sudo tee -a /etc/ssh/sshd_config && sudo systemctl reload sshd`;

  async function enable() {
    setBusy(true);
    try {
      await createCa();
      toast.success(t("sshId.caEnabled"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.caCreateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!window.confirm(t("sshId.caRotateConfirm"))) return;
    setBusy(true);
    try {
      await rotateCa();
      toast.success(t("sshId.caRotated"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.caRotateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("sshId.caDeleteConfirm"))) return;
    setBusy(true);
    try {
      await deleteCa();
      toast.success(t("sshId.caDeleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("sshId.caDeleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title={t("sshId.caTitle")}
      icon={<ShieldCheck className="size-3.5" />}
      action={
        !ca ? (
          <Button
            variant="outline"
            size="sm"
            className={accentBtn}
            onClick={enable}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="animate-spin size-3.5" />
            ) : (
              t("sshId.caEnable")
            )}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={rotate}
              disabled={busy}
            >
              <RefreshCw className="size-3.5" />
              {t("sshId.caRotate")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </div>
        )
      }
    >
      <div className="py-2.5 border-b border-border last:border-0">
        <p className="text-xs text-muted-foreground leading-snug">
          {t("sshId.caIntro")}
        </p>
      </div>
      {ca && (
        <>
          <CopyRow label={t("sshId.caTrustLabel")} value={trustCmd} />
          <CopyRow label={t("sshId.caPublicKeyLabel")} value={ca.publicKey} />
        </>
      )}
    </SectionCard>
  );
}
