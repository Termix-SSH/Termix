import { Select2 } from "@/components/select2";
import { FormFooter } from "@/components/list-kit";
import { InlineView } from "@/components/surface/surface-scope";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getCredentials,
  getHostAuthOverride,
  setHostAuthOverride,
} from "@/main-axios";
import type { Credential, Host } from "@/types/ui-types";
import {
  SSH_AUTH_PROTOCOL,
  type AuthOverrideProtocol,
} from "@/types/auth-protocols";
import { authProtocolLabel } from "./host-permissions";
import { mapCredentials } from "./HostManagerData";
import { getConnectedRemoteApi } from "@/lib/remote-server-api";

export function HostAuthOverrideModal({
  open,
  onOpenChange,
  host,
  protocol,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: Host;
  protocol: AuthOverrideProtocol;
}) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [initialId, setInitialId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const overrideState = host.authOverrides?.[protocol];
  const ownerAuthShared =
    overrideState?.ownerAuthShared ??
    (protocol === SSH_AUTH_PROTOCOL ? !!host.shareSshAuth : false);
  // A shared host's copy on a linked desktop: its override lives on the
  // server, against the server's own credentials.
  const sharedCopySyncId = host.sharedCopy ? (host.syncId ?? null) : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    const credentialsRequest = sharedCopySyncId
      ? getConnectedRemoteApi().then((api) => {
          if (!api) throw new Error("The linked server is not reachable");
          return api.get("/credentials").then((response) => response.data);
        })
      : getCredentials();

    Promise.all([
      credentialsRequest,
      getHostAuthOverride(Number(host.id), protocol, sharedCopySyncId),
    ])
      .then(([credentialResult, overrideResult]) => {
        if (cancelled) return;
        const nextCredentials = mapCredentials(credentialResult);
        const nextId =
          overrideResult.credentialId == null
            ? ""
            : String(overrideResult.credentialId);
        setCredentials(nextCredentials);
        setSelectedId(nextId);
        setInitialId(nextId);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [host.id, open, protocol, sharedCopySyncId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const credentialId = selectedId ? Number(selectedId) : null;
      await setHostAuthOverride(
        Number(host.id),
        protocol,
        credentialId,
        sharedCopySyncId,
      );
      toast.success(
        credentialId === null
          ? t(
              ownerAuthShared
                ? "hosts.sharing.authOverrideClearedToShared"
                : "hosts.sharing.authOverrideCleared",
            )
          : t("hosts.sharing.authOverrideSaved"),
      );
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      onOpenChange(false);
    } catch {
      toast.error(t("hosts.sharing.authOverrideSaveError"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <span
      className="contents"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <InlineView
        open={open}
        onOpenChange={onOpenChange}
        title={
          <>
            {t("hosts.sharing.authOverrideTitleProtocol", {
              protocol: authProtocolLabel(protocol, t),
            })}
          </>
        }
        footer={
          <FormFooter
            onCancel={() => onOpenChange(false)}
            onSave={() => void handleSave()}
            saving={saving}
            disabled={loading || loadError || selectedId === initialId}
          />
        }
      >
        <p className="text-xs text-muted-foreground">
          {t(
            ownerAuthShared
              ? "hosts.sharing.authOverrideDescriptionShared"
              : "hosts.sharing.authOverrideDescriptionPrivate",
            { host: host.name },
          )}
        </p>
        {loading ? (
          <p className="py-4 text-center text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : loadError ? (
          <p className="border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {t("hosts.sharing.authOverrideLoadError")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`auth-override-${host.id}`}
              className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
            >
              {t("hosts.sharing.authOverrideCredentialLabel")}
            </label>
            <Select2
              id={`auth-override-${host.id}`}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">
                {t(
                  ownerAuthShared
                    ? "hosts.sharing.useSharedAuthentication"
                    : "hosts.sharing.noPersonalCredential",
                )}
              </option>
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.username
                    ? `${credential.name} (${credential.username})`
                    : credential.name}
                </option>
              ))}
            </Select2>
            {credentials.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                {t("hosts.sharing.authOverrideNoCredentials")}
              </p>
            )}
            {overrideState?.required && selectedId === "" && (
              <p className="border border-warning/30 bg-warning/5 p-2 text-[10px] text-warning">
                {t("hosts.sharing.authOverrideRequired")}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.sharing.authOverridePrivateHint")}
            </p>
          </div>
        )}
      </InlineView>
    </span>
  );
}
