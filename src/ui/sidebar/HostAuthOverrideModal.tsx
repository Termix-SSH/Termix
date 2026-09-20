import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  getCredentials,
  getHostAuthOverride,
  setHostAuthOverride,
} from "@/main-axios";
import type { Credential, Host } from "@/types/ui-types";
import {
  AUTH_PROTOCOL_METADATA,
  type AuthOverrideProtocol,
} from "@/types/auth-protocols";
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
    (protocol === "ssh" ? !!host.shareSshAuth : false);
  const remoteShared = !!host.isShared && Number(host.id) < 0;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    const credentialsRequest = remoteShared
      ? getConnectedRemoteApi().then((api) => {
          if (!api) throw new Error("Remote server is not connected");
          return api.get("/credentials").then((response) => response.data);
        })
      : getCredentials();

    Promise.all([
      credentialsRequest,
      remoteShared
        ? getHostAuthOverride(Number(host.id), protocol, true)
        : getHostAuthOverride(Number(host.id), protocol),
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
  }, [host.id, open, protocol, remoteShared]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const credentialId = selectedId ? Number(selectedId) : null;
      if (remoteShared) {
        await setHostAuthOverride(
          Number(host.id),
          protocol,
          credentialId,
          true,
        );
      } else {
        await setHostAuthOverride(Number(host.id), protocol, credentialId);
      }
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("hosts.sharing.authOverrideTitleProtocol", {
                protocol: AUTH_PROTOCOL_METADATA[protocol].label,
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                ownerAuthShared
                  ? "hosts.sharing.authOverrideDescriptionShared"
                  : "hosts.sharing.authOverrideDescriptionPrivate",
                { host: host.name },
              )}
            </DialogDescription>
          </DialogHeader>

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
              <select
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
              </select>
              {credentials.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t("hosts.sharing.authOverrideNoCredentials")}
                </p>
              )}
              {overrideState?.required && selectedId === "" && (
                <p className="border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-600 dark:text-amber-400">
                  {t("hosts.sharing.authOverrideRequired")}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {t("hosts.sharing.authOverridePrivateHint")}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleSave}
              disabled={
                loading || loadError || saving || selectedId === initialId
              }
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
