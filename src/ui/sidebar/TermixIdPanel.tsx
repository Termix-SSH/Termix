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
import { Textarea } from "@/components/textarea";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import {
  getMyTermixId,
  checkTermixIdHandle,
  createTermixId,
  deleteTermixId,
  addTermixIdKey,
  generateTermixIdKey,
  setTermixIdKeyEnabled,
  deleteTermixIdKey,
  getCredentials,
  getMyCa,
  createCa,
  rotateCa,
  deleteCa,
  issueCertificate,
  getLinkedCredentialIds,
  type TermixIdentity,
  type TermixIdentityKey,
  type TermixIdCa,
} from "@/main-axios";

const accentBtn =
  "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/20 hover:text-accent-brand";

function resolverUrl(handle: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-termix";
  return `${origin}/termix-id/u/${handle}`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("termixId.copyFailed"));
    }
  }
  return (
    <div className="flex flex-col gap-1.5 py-2.5 border-b border-border last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 text-[11px] font-mono bg-muted/30 border border-border px-2 py-1.5 overflow-x-auto whitespace-nowrap text-muted-foreground">
          {value}
        </code>
        <button
          onClick={copy}
          className="shrink-0 w-7 flex items-center justify-center border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="size-3.5 text-accent-brand" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

export function TermixIdPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<TermixIdentity | null>(null);
  const [keys, setKeys] = useState<TermixIdentityKey[]>([]);
  const [ca, setCa] = useState<TermixIdCa | null>(null);
  const [linkedCredentialIds, setLinkedCredentialIds] = useState<Set<number>>(
    new Set(),
  );

  const refresh = useCallback(async () => {
    try {
      const [data, caData, linkedData] = await Promise.all([
        getMyTermixId(),
        getMyCa().catch(() => ({ ca: null })),
        getLinkedCredentialIds().catch(() => ({ credentialIds: [] })),
      ]);
      setIdentity(data.identity);
      setKeys(data.keys);
      setCa(data.identity ? caData.ca : null);
      setLinkedCredentialIds(new Set(linkedData.credentialIds));
    } catch {
      toast.error(t("termixId.loadFailed"));
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
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
      <div className="flex flex-col gap-3 p-3">
        {!identity ? (
          <ClaimHandle onCreated={refresh} />
        ) : (
          <>
            <IdentityCard identity={identity} onChanged={refresh} />
            <AddKey
              handle={identity.handle}
              linkedCredentialIds={linkedCredentialIds}
              onAdded={refresh}
            />
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
        const res = await checkTermixIdHandle(h);
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
      await createTermixId(
        handle.trim().toLowerCase(),
        description.trim() || undefined,
      );
      toast.success(t("termixId.created"));
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("termixId.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title={t("termixId.title")}
      icon={<Fingerprint className="size-3.5" />}
      action={
        <a
          href="https://docs.termix.site/features/authentication/termix-id"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.docsLink")}
        </a>
      }
    >
      <div className="flex flex-col gap-3 py-3">
        <p className="text-xs text-muted-foreground leading-snug">
          {t("termixId.claimIntro")}
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("termixId.handleLabel")}
          </span>
          <div className="relative flex items-center">
            <span className="absolute left-2 text-muted-foreground text-xs pointer-events-none select-none">
              @
            </span>
            <Input
              value={handle}
              placeholder={t("termixId.handlePlaceholder")}
              autoCapitalize="none"
              spellCheck={false}
              className="h-8 text-xs pl-5"
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <span className="text-[11px] h-4 leading-4">
            {checking ? (
              <span className="text-muted-foreground">
                {t("termixId.checking")}
              </span>
            ) : status === "available" ? (
              <span className="text-accent-brand">
                {t("termixId.available")}
              </span>
            ) : status === "taken" ? (
              <span className="text-destructive">{t("termixId.taken")}</span>
            ) : status === "invalid" ? (
              <span className="text-destructive">
                {t("termixId.invalidHandle")}
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("termixId.descriptionLabel")}
          </span>
          <Input
            value={description}
            placeholder={t("termixId.descriptionPlaceholder")}
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
            t("termixId.create")
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
  identity: TermixIdentity;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = resolverUrl(identity.handle);
  const curl = `curl -fsSL ${url} >> ~/.ssh/authorized_keys`;

  async function remove() {
    setBusy(true);
    try {
      await deleteTermixId();
      toast.success(t("termixId.deleted"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("termixId.deleteFailed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <SectionCard
      title={t("termixId.title")}
      icon={<Fingerprint className="size-3.5" />}
      action={
        confirming ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={remove}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="animate-spin size-3.5" />
              ) : (
                t("common.confirm")
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              {t("nav.cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <a
              href="https://docs.termix.site/features/authentication/termix-id"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-accent-brand hover:underline px-1"
            >
              {t("hosts.docsLink")}
            </a>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirming(true)}
              className="hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )
      }
    >
      {confirming && (
        <div className="py-2 border-b border-border">
          <p className="text-xs text-muted-foreground">
            {t("termixId.deleteConfirm")}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-accent-brand">
          @{identity.handle}
        </span>
      </div>
      <CopyRow label={t("termixId.resolverUrlLabel")} value={url} />
      <CopyRow label={t("termixId.provisionLabel")} value={curl} />
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

function CredentialImportRow({
  credentials,
  linkedCredentialIds,
  submitting,
  onImport,
}: {
  credentials: CredentialOption[];
  linkedCredentialIds: Set<number>;
  submitting: boolean;
  onImport: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>("");
  const selectedId = selected ? Number(selected) : null;
  const alreadyLinked =
    selectedId !== null && linkedCredentialIds.has(selectedId);

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={submitting}
        className="flex-1 h-8 min-w-0 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="" disabled>
          {t("termixId.selectCredential")}
        </option>
        {credentials.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {linkedCredentialIds.has(c.id) ? `✓ ${c.name}` : c.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="default"
        className={`h-8 shrink-0 ${alreadyLinked ? "border-accent-brand/20 text-accent-brand/50" : accentBtn}`}
        disabled={!selectedId || submitting || alreadyLinked}
        onClick={() => selectedId !== null && onImport(selectedId)}
      >
        {alreadyLinked ? <Check className="size-3.5" /> : t("termixId.import")}
      </Button>
    </div>
  );
}

function AddKey({
  handle,
  linkedCredentialIds,
  onAdded,
}: {
  handle: string;
  linkedCredentialIds: Set<number>;
  onAdded: () => void;
}) {
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
      await addTermixIdKey({
        publicKey: publicKey.trim(),
        label: label.trim() || undefined,
      });
      toast.success(t("termixId.keyPublished"));
      setPublicKey("");
      setLabel("");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("termixId.addKeyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const result = await generateTermixIdKey("ed25519", saveToVault);
      downloadText(`termix-${handle}-ed25519.key`, result.privateKey);
      toast.success(
        saveToVault
          ? t("termixId.generatedSaved")
          : t("termixId.generatedOnly"),
      );
      if (saveToVault) loadCredentials();
      onAdded();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.generateFailed"),
      );
    } finally {
      setGenerating(false);
    }
  }

  async function importCredential(id: number) {
    setSubmitting(true);
    try {
      await addTermixIdKey({ credentialId: id });
      toast.success(t("termixId.imported"));
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("termixId.importFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title={t("termixId.publishTitle")}
      icon={<Plus className="size-3.5" />}
      action={
        <Button
          variant="outline"
          size="sm"
          className={accentBtn}
          onClick={generate}
          disabled={generating}
          title={t("termixId.generateTooltip")}
        >
          {generating ? (
            <Loader2 className="animate-spin size-3.5" />
          ) : (
            <>
              <Sparkles className="size-3.5" />
              {t("termixId.generate")}
            </>
          )}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-3">
        <SettingRow label={t("termixId.saveToVault")}>
          <FakeSwitch checked={saveToVault} onChange={setSaveToVault} />
        </SettingRow>

        <Textarea
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder={t("termixId.keyPlaceholder")}
          rows={3}
          className="rounded-none font-mono text-[11px]"
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("termixId.labelPlaceholder")}
            className="h-8 text-xs flex-1"
          />
          <Button
            variant="outline"
            size="default"
            className={`h-8 ${accentBtn}`}
            onClick={addManual}
            disabled={!publicKey.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="animate-spin size-3.5" />
            ) : (
              t("termixId.add")
            )}
          </Button>
        </div>

        {credentials.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("termixId.importFromCredential")}
            </span>
            <CredentialImportRow
              credentials={credentials}
              linkedCredentialIds={linkedCredentialIds}
              submitting={submitting}
              onImport={importCredential}
            />
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
  keys: TermixIdentityKey[];
  handle: string;
  caEnabled: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [issuingId, setIssuingId] = useState<number | null>(null);

  async function toggle(k: TermixIdentityKey) {
    try {
      await setTermixIdKeyEnabled(k.id, !k.enabled);
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.updateKeyFailed"),
      );
    }
  }

  async function remove(k: TermixIdentityKey) {
    try {
      await deleteTermixIdKey(k.id);
      toast.success(t("termixId.keyRemoved"));
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.removeKeyFailed"),
      );
    }
  }

  async function issueCert(k: TermixIdentityKey) {
    setIssuingId(k.id);
    try {
      const res = await issueCertificate(k.id);
      downloadText(`termix-${handle}-${k.id}-cert.pub`, res.certificate + "\n");
      toast.success(t("termixId.certIssued"));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.certIssueFailed"),
      );
    } finally {
      setIssuingId(null);
    }
  }

  return (
    <div className="flex flex-col border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="text-muted-foreground">
          <KeyRound className="size-3.5" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex-1">
          {t("termixId.keysTitle")}
        </span>
      </div>
      {keys.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">
          {t("termixId.noKeys")}
        </p>
      ) : (
        keys.map((k) => {
          const canCert = caEnabled && k.algorithm.toUpperCase() === "ED25519";
          return (
            <div
              key={k.id}
              className="flex flex-col px-3 py-2 gap-1 border-b border-border last:border-0"
            >
              {/* row 1: label + badges */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent-brand border border-accent-brand/40 px-1 py-px shrink-0 leading-none">
                  {k.algorithm}
                </span>
                {k.credentialId && (
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-accent-brand/60 border border-accent-brand/20 px-1 py-px shrink-0 leading-none">
                    {t("termixId.fromVault")}
                  </span>
                )}
                <span className="text-xs font-medium truncate min-w-0">
                  {k.label || k.comment || k.keyType}
                </span>
              </div>
              {/* row 2: public key */}
              <code className="text-[10px] font-mono text-muted-foreground truncate">
                {k.publicKey}
              </code>
              {/* row 3: actions */}
              <div className="flex items-center gap-1 pt-0.5">
                <FakeSwitch checked={k.enabled} onChange={() => toggle(k)} />
                {canCert && (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => issueCert(k)}
                    disabled={issuingId === k.id}
                    title={t("termixId.issueCertTooltip")}
                  >
                    {issuingId === k.id ? (
                      <Loader2 className="animate-spin size-3.5" />
                    ) : (
                      <ScrollText className="size-3.5" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(k)}
                  className="hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })
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
  ca: TermixIdCa | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const caUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/termix-id/u/${handle}/ca`
      : `/termix-id/u/${handle}/ca`;
  const trustCmd = `curl -fsSL ${caUrl} | sudo tee /etc/ssh/${handle}-ca.pub && echo "TrustedUserCAKeys /etc/ssh/${handle}-ca.pub" | sudo tee -a /etc/ssh/sshd_config && sudo systemctl reload sshd`;

  async function enable() {
    setBusy(true);
    try {
      await createCa();
      toast.success(t("termixId.caEnabled"));
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.caCreateFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      await rotateCa();
      toast.success(t("termixId.caRotated"));
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.caRotateFailed"),
      );
    } finally {
      setBusy(false);
      setConfirmingRotate(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteCa();
      toast.success(t("termixId.caDeleted"));
      onChanged();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("termixId.caDeleteFailed"),
      );
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <SectionCard
      title={t("termixId.caTitle")}
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
              t("termixId.caEnable")
            )}
          </Button>
        ) : confirmingRotate ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={rotate}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="animate-spin size-3.5" />
              ) : (
                t("termixId.caRotate")
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingRotate(false)}
            >
              {t("nav.cancel")}
            </Button>
          </div>
        ) : confirmingDelete ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={remove}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="animate-spin size-3.5" />
              ) : (
                t("termixId.caDelete")
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("nav.cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingRotate(true)}
              disabled={busy}
            >
              <RefreshCw className="size-3.5" />
              {t("termixId.caRotate")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )
      }
    >
      <div className="py-2.5 border-b border-border">
        <p className="text-xs text-muted-foreground leading-snug">
          {t("termixId.caIntro")}
        </p>
      </div>
      {confirmingRotate && (
        <div className="py-2.5 border-b border-border">
          <p className="text-xs text-destructive/80 leading-snug">
            {t("termixId.caRotateConfirm")}
          </p>
        </div>
      )}
      {confirmingDelete && (
        <div className="py-2.5 border-b border-border">
          <p className="text-xs text-destructive/80 leading-snug">
            {t("termixId.caDeleteConfirm")}
          </p>
        </div>
      )}
      {ca && (
        <>
          <CopyRow label={t("termixId.caTrustLabel")} value={trustCmd} />
          <CopyRow
            label={t("termixId.caPublicKeyLabel")}
            value={ca.publicKey}
          />
        </>
      )}
    </SectionCard>
  );
}
