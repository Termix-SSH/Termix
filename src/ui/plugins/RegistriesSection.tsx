import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Library, Trash2 } from "lucide-react";
import { Input } from "@/components/input";
import { FakeSwitch } from "@/components/section-card";
import { PANEL } from "@/components/panel-layout";
import {
  AddButton,
  FormFooter,
  ListBadge,
  ListRow,
  ListRowAction,
} from "@/components/list-kit";
import { InlineView, useConfirm } from "@/components/surface/surface-scope";
import { DocsLink } from "@/components/docs-link";
import {
  addRegistry,
  getRegistries,
  previewRegistry,
  removeRegistry,
  setRegistryEnabled,
  type RegistriesState,
  type RegistryListingSource,
  type RegistryPreview,
} from "@/api/plugins-api";
import type { PluginsManager } from "./use-plugins-manager";

function errorOf(error: unknown): {
  message: string;
  code?: string;
  data: Record<string, unknown>;
} {
  const data = (error as { response?: { data?: Record<string, unknown> } })
    ?.response?.data;
  return {
    message:
      typeof data?.error === "string"
        ? data.error
        : error instanceof Error
          ? error.message
          : String(error),
    code: typeof data?.code === "string" ? data.code : undefined,
    data: data ?? {},
  };
}

export function RegistriesSection({ manager }: { manager: PluginsManager }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [state, setState] = useState<RegistriesState | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getRegistries());
    } catch (error) {
      toast.error(
        t("plugins.manager.registries.loadFailed", {
          error: errorOf(error).message,
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOf = (id: string): RegistryListingSource | undefined =>
    manager.registries.find((entry) => entry.id === id);

  const toggle = async (id: string, enabled: boolean) => {
    if (enabled && id === "community") {
      const ok = await confirm({
        title: t("plugins.manager.registries.communityConfirmTitle"),
        description: t("plugins.manager.registries.communityConfirmBody"),
        confirmLabel: t("plugins.manager.registries.communityConfirm"),
        destructive: false,
      });
      if (!ok) return;
    }
    setBusy(id);
    try {
      await setRegistryEnabled(id, enabled);
      await load();
      await manager.refresh();
    } catch (error) {
      toast.error(
        t("plugins.manager.registries.changeFailed", {
          error: errorOf(error).message,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: t("plugins.manager.registries.removeTitle", { name }),
      description: t("plugins.manager.registries.removeBody"),
      confirmLabel: t("plugins.manager.registries.remove"),
    });
    if (!ok) return;
    setBusy(id);
    try {
      await removeRegistry(id);
      toast.success(t("plugins.manager.registries.removed", { name }));
      await load();
      await manager.refresh();
    } catch (error) {
      const info = errorOf(error);
      toast.error(
        info.code === "REGISTRY_IN_USE"
          ? t("plugins.manager.registries.inUse", {
              name,
              list: ((info.data.plugins as string[]) ?? []).join(", "),
            })
          : t("plugins.manager.registries.changeFailed", {
              error: info.message,
            }),
      );
    } finally {
      setBusy(null);
    }
  };

  const readOnly = manager.managedByServer || state?.managedByServer;

  const meta = (id: string, url: string, extra?: string) => {
    const status = statusOf(id);
    const parts = [url];
    if (status && !status.error) {
      parts.push(
        t("plugins.manager.registries.pluginCount", { count: status.plugins }),
      );
    }
    if (extra) parts.push(extra);
    return parts.join(" | ");
  };

  const errorLine = (id: string) => {
    const error = statusOf(id)?.error;
    return error ? (
      <span className="text-[11px] leading-snug text-destructive">
        {t("plugins.manager.registries.unreachable", { error })}
      </span>
    ) : null;
  };

  return (
    <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
          {t("plugins.manager.registries.intro")}{" "}
          <DocsLink core="hostRegistry" className="text-[11px]">
            {t("plugins.manager.registries.hostYourOwn")}
          </DocsLink>
        </p>
        {!readOnly && (
          <AddButton
            label={t("plugins.manager.registries.add")}
            onClick={() => setAdding(true)}
          />
        )}
      </div>

      {state && (
        <div className="flex flex-col border-t border-border/40">
          <ListRow
            stripe={0}
            icon={<Library />}
            title={t("plugins.manager.registries.officialName")}
            badges={
              <ListBadge tone="brand">
                {t("plugins.manager.registries.alwaysOn")}
              </ListBadge>
            }
            meta={meta("official", state.official.url)}
          >
            {errorLine("official")}
          </ListRow>

          <ListRow
            stripe={1}
            icon={<Library />}
            tone={state.community.enabled ? "brand" : "muted"}
            dimmed={!state.community.enabled}
            title={t("plugins.manager.registries.communityName")}
            meta={meta("community", state.community.url)}
            trailing={
              <FakeSwitch
                checked={state.community.enabled}
                disabled={readOnly || busy === "community"}
                onChange={(next) => void toggle("community", next)}
              />
            }
          >
            <span className="text-[11px] leading-snug text-muted-foreground">
              {t("plugins.manager.registries.communityHint")}{" "}
              <DocsLink core="communityRegistry" className="text-[11px]">
                {t("plugins.manager.communitySubmit")}
              </DocsLink>
            </span>
            {state.community.enabled && errorLine("community")}
          </ListRow>

          {state.custom.map((entry, index) => (
            <ListRow
              key={entry.id}
              stripe={index}
              icon={<Library />}
              tone={entry.enabled ? "warning" : "muted"}
              dimmed={!entry.enabled}
              title={entry.name}
              badges={
                <ListBadge tone="warning">
                  {t("plugins.manager.registries.customBadge")}
                </ListBadge>
              }
              meta={meta(
                entry.id,
                entry.url,
                t("plugins.manager.registries.keyFingerprint", {
                  keyId: entry.keyId,
                }),
              )}
              trailing={
                <FakeSwitch
                  checked={entry.enabled}
                  disabled={readOnly || busy === entry.id}
                  onChange={(next) => void toggle(entry.id, next)}
                />
              }
              actions={
                readOnly ? undefined : (
                  <ListRowAction
                    label={t("plugins.manager.registries.remove")}
                    tone="destructive"
                    disabled={busy === entry.id}
                    onClick={() => void remove(entry.id, entry.name)}
                  >
                    <Trash2 />
                  </ListRowAction>
                )
              }
            >
              {entry.enabled && errorLine(entry.id)}
            </ListRow>
          ))}
        </div>
      )}

      <AddRegistryView
        open={adding}
        onOpenChange={setAdding}
        onAdded={async () => {
          setAdding(false);
          await load();
          await manager.refresh();
        }}
      />
    </div>
  );
}

function AddRegistryView({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<RegistryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setPreview(null);
      setError(null);
    }
  }, [open]);

  const check = async () => {
    setWorking(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewRegistry(url.trim()));
    } catch (failure) {
      setError(errorOf(failure).message);
    } finally {
      setWorking(false);
    }
  };

  const add = async () => {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      const added = await addRegistry(preview.url, preview.keyId);
      toast.success(
        t("plugins.manager.registries.added", { name: added.name }),
      );
      await onAdded();
    } catch (failure) {
      const info = errorOf(failure);
      if (info.code === "KEY_MISMATCH") setPreview(null);
      setError(info.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <InlineView
      open={open}
      onOpenChange={onOpenChange}
      title={t("plugins.manager.registries.addTitle")}
      icon={<Library className="size-4" />}
      footer={
        <FormFooter
          onCancel={() => onOpenChange(false)}
          onSave={() => void (preview ? add() : check())}
          saveLabel={
            preview
              ? t("plugins.manager.registries.addConfirm")
              : t("plugins.manager.registries.check")
          }
          saving={working}
          disabled={!url.trim()}
        />
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("plugins.manager.registries.addHint")}
        </p>
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim() && !working) {
              e.preventDefault();
              void (preview ? add() : check());
            }
          }}
          placeholder="https://example.com/termix/index.json"
          className="h-8 text-xs"
          aria-label={t("plugins.manager.registries.urlLabel")}
          autoFocus
        />
        {error && (
          <p className="text-[11px] leading-snug text-destructive">{error}</p>
        )}
        {preview && (
          <div className="flex flex-col gap-1.5 border border-warning/40 bg-warning/5 p-3">
            <span className="text-sm font-semibold">{preview.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("plugins.manager.registries.pluginCount", {
                count: preview.plugins,
              })}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("plugins.manager.registries.keyFingerprint", {
                keyId: preview.keyId,
              })}
            </span>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("plugins.manager.registries.customWarning")}
            </p>
          </div>
        )}
      </div>
    </InlineView>
  );
}
