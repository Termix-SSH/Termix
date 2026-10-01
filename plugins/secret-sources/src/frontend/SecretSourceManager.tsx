import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, PasswordInput } from "@termix/plugin-sdk/ui";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import {
  createSecretSourcesApi,
  type SecretSource,
} from "./secret-sources-api";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

type FormState = {
  id?: string;
  name: string;
  baseUrl: string;
  token: string;
  shared: boolean;
};

const emptyForm: FormState = {
  name: "",
  baseUrl: "",
  token: "",
  shared: false,
};

export function SecretSourceManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const pluginApi = usePluginApi();
  const api = useMemo(() => createSecretSourcesApi(pluginApi), [pluginApi]);
  const [sources, setSources] = useState<SecretSource[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSources(await api.list());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    if (!form) return;
    if (
      !form.name.trim() ||
      !form.baseUrl.trim() ||
      (!form.id && !form.token)
    ) {
      toast.error(t("required"));
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await api.update(form.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          shared: form.shared,
          ...(form.token ? { token: form.token } : {}),
        });
      } else {
        await api.create({
          name: form.name,
          baseUrl: form.baseUrl,
          token: form.token,
          shared: form.shared,
        });
      }
      toast.success(t("saved"));
      setForm(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (source: SecretSource) => {
    try {
      await api.remove(source.id);
      toast.success(t("deleted"));
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const handleTest = async (source: SecretSource) => {
    setTesting(source.id);
    try {
      const result = await api.test(source.id);
      if (result.ok) {
        toast.success(t("testOk", { count: result.vaults ?? 0 }));
      } else {
        toast.error(result.error ?? t("testFailed"));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 col-span-2 border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("title")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("description")}</p>

      {!form && (
        <>
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-2 border border-border bg-background px-2 py-1.5 text-xs"
            >
              <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">
                  {source.name}
                  {source.shared && (
                    <span className="ml-1 text-[9px] uppercase text-muted-foreground">
                      {t("shared")}
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {source.baseUrl}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                disabled={testing === source.id}
                onClick={() => void handleTest(source)}
              >
                {t("test")}
              </Button>
              {source.owned && (
                <>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setForm({
                        id: source.id,
                        name: source.name,
                        baseUrl: source.baseUrl,
                        token: "",
                        shared: source.shared,
                      })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDelete(source)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start border-accent-brand/40 text-accent-brand"
            onClick={() => setForm(emptyForm)}
          >
            <Plus className="size-3 mr-1" /> {t("new")}
          </Button>
        </>
      )}

      {form && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("nameLabel")}
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="Team 1Password"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("urlLabel")}
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="https://connect.internal:8080"
                value={form.baseUrl}
                onChange={(e) => setField("baseUrl", e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("tokenLabel")}
            </label>
            <PasswordInput
              className="h-8 text-xs pr-8"
              placeholder={form.id ? t("tokenKeep") : "eyJhbGciOi..."}
              value={form.token}
              onChange={(e) => setField("token", e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={form.shared}
              onChange={(e) => setField("shared", e.target.checked)}
            />
            {t("sharedLabel")}
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setForm(null)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-accent-brand/40 text-accent-brand"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {form.id ? t("common.save") : t("common.create")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
