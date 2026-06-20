import { useEffect, useState, useCallback } from "react";
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
import { Label } from "@/components/label";
import { Textarea } from "@/components/textarea";
import { Switch } from "@/components/switch";
import { Badge } from "@/components/badge";
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

function resolverUrl(handle: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-termix";
  return `${origin}/sshid/u/${handle}`;
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
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto">
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
  const [copied, setCopied] = useState(false);

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

  async function copyTrust() {
    try {
      await navigator.clipboard.writeText(trustCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("sshId.copyFailed"));
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent-brand" />
          <h3 className="text-sm font-semibold">{t("sshId.caTitle")}</h3>
        </div>
        {!ca ? (
          <Button size="sm" onClick={enable} disabled={busy}>
            {busy ? (
              <Loader2 className="animate-spin" size={14} />
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
              <RefreshCw size={13} className="mr-1" />
              {t("sshId.caRotate")}
            </Button>
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
              <Trash2 size={14} className="text-red-500" />
            </Button>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("sshId.caIntro")}
      </p>

      {ca && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("sshId.caTrustLabel")}
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] bg-muted/60 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                {trustCmd}
              </code>
              <Button variant="outline" size="sm" onClick={copyTrust}>
                {copied ? (
                  <Check size={14} className="text-green-500" />
                ) : (
                  <Copy size={14} />
                )}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("sshId.caPublicKeyLabel")}
            </Label>
            <code className="text-[11px] bg-muted/60 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap text-muted-foreground">
              {ca.publicKey}
            </code>
          </div>
        </>
      )}
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
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Fingerprint size={18} className="text-accent-brand" />
        <h2 className="text-sm font-semibold">{t("sshId.claimTitle")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("sshId.claimIntro")}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sshid-handle">{t("sshId.handleLabel")}</Label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">@</span>
          <Input
            id="sshid-handle"
            value={handle}
            placeholder={t("sshId.handlePlaceholder")}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value)}
          />
        </div>
        <span className="text-xs h-4">
          {checking ? (
            <span className="text-muted-foreground">{t("sshId.checking")}</span>
          ) : status === "available" ? (
            <span className="text-green-500">{t("sshId.available")}</span>
          ) : status === "taken" ? (
            <span className="text-red-500">{t("sshId.taken")}</span>
          ) : status === "invalid" ? (
            <span className="text-red-500">{t("sshId.invalidHandle")}</span>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sshid-desc">{t("sshId.descriptionLabel")}</Label>
        <Input
          id="sshid-desc"
          value={description}
          placeholder={t("sshId.descriptionPlaceholder")}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <Button
        disabled={status !== "available" || submitting}
        onClick={submit}
        className="self-start"
      >
        {submitting ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          t("sshId.create")
        )}
      </Button>
    </div>
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
  const [copiedTarget, setCopiedTarget] = useState<"url" | "curl" | null>(null);
  const url = resolverUrl(identity.handle);
  const curl = `curl -fsSL ${url} >> ~/.ssh/authorized_keys`;

  async function copy(text: string, target: "url" | "curl") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setTimeout(() => setCopiedTarget((c) => (c === target ? null : c)), 1500);
    } catch {
      toast.error(t("sshId.copyFailed"));
    }
  }

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
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint size={18} className="text-accent-brand" />
          <span className="text-sm font-semibold">@{identity.handle}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={remove}>
          <Trash2 size={14} className="text-red-500" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("sshId.resolverUrlLabel")}
        </Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-muted/60 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
            {url}
          </code>
          <Button variant="outline" size="sm" onClick={() => copy(url, "url")}>
            {copiedTarget === "url" ? (
              <Check size={14} className="text-green-500" />
            ) : (
              <Copy size={14} />
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">
          {t("sshId.provisionLabel")}
        </Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-muted/60 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
            {curl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(curl, "curl")}
          >
            {copiedTarget === "curl" ? (
              <Check size={14} className="text-green-500" />
            ) : (
              <Copy size={14} />
            )}
          </Button>
        </div>
      </div>
    </div>
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
      const fname = `termix-${handle}-ed25519.key`;
      downloadText(fname, result.privateKey);
      toast.success(
        saveToVault ? t("sshId.generatedSaved") : t("sshId.generatedOnly"),
      );
      // A vault-saved key becomes a new import option — refresh the dropdown.
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
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plus size={16} />
          <h3 className="text-sm font-semibold">{t("sshId.publishTitle")}</h3>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={generate}
          disabled={generating}
          title={t("sshId.generateTooltip")}
        >
          {generating ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <>
              <Sparkles size={13} className="mr-1" />
              {t("sshId.generate")}
            </>
          )}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("sshId.generateIntro")}
      </p>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
        <Switch checked={saveToVault} onCheckedChange={setSaveToVault} />
        {t("sshId.saveToVault")}
      </label>

      <Textarea
        value={publicKey}
        onChange={(e) => setPublicKey(e.target.value)}
        placeholder={t("sshId.keyPlaceholder")}
        rows={3}
        className="font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("sshId.labelPlaceholder")}
          className="flex-1"
        />
        <Button onClick={addManual} disabled={!publicKey.trim() || submitting}>
          {submitting ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            t("sshId.add")
          )}
        </Button>
      </div>

      {credentials.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <Label className="text-xs text-muted-foreground">
            {t("sshId.importFromCredential")}
          </Label>
          <div className="flex flex-wrap gap-2">
            {credentials.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => importCredential(c.id)}
              >
                <KeyRound size={13} className="mr-1" />
                {c.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
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

  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground px-1">{t("sshId.noKeys")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {keys.map((k) => {
        const canCert = caEnabled && k.algorithm.toUpperCase() === "ED25519";
        return (
          <div
            key={k.id}
            className="rounded-lg border border-border p-3 flex items-center gap-3"
          >
            <Badge variant="secondary" className="shrink-0">
              {k.algorithm}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {k.label || k.comment || k.keyType}
              </div>
              <code className="text-[11px] text-muted-foreground truncate block">
                {k.publicKey}
              </code>
            </div>
            {canCert && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => issueCert(k)}
                disabled={issuingId === k.id}
                title={t("sshId.issueCertTooltip")}
              >
                {issuingId === k.id ? (
                  <Loader2 className="animate-spin" size={13} />
                ) : (
                  <ScrollText size={13} />
                )}
              </Button>
            )}
            <Switch
              checked={k.enabled}
              onCheckedChange={() => toggle(k)}
              title={k.enabled ? t("sshId.published") : t("sshId.hidden")}
            />
            <Button variant="ghost" size="sm" onClick={() => remove(k)}>
              <Trash2 size={14} className="text-red-500" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
