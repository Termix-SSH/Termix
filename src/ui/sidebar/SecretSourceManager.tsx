import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { getErrorMessage } from "@/lib/error-message";
import {
  createSecretSource,
  deleteSecretSource,
  listSecretSources,
  testSecretSource,
  updateSecretSource,
  type SecretSource,
} from "@/api/secret-sources-api";

/** One line under a secret field: references are allowed, here is where to set them up. */
export function SecretReferenceHint({ onManage }: { onManage: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="text-[10px] text-muted-foreground">
      {t("hosts.secretRefHint")}{" "}
      <button
        type="button"
        className="text-accent-brand hover:underline"
        onClick={onManage}
      >
        {t("hosts.secretSourcesManage")}
      </button>
    </p>
  );
}

type FormState = {
  id?: string;
  name: string;
  baseUrl: string;
  token: string;
  shared: boolean;
};

const emptyForm: FormState = { name: "", baseUrl: "", token: "", shared: false };

export function SecretSourceManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<SecretSource[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSources(await listSecretSources());
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim() || !form.baseUrl.trim() || (!form.id && !form.token)) {
      toast.error(t("hosts.secretSourceRequired"));
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await updateSecretSource(form.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          shared: form.shared,
          ...(form.token ? { token: form.token } : {}),
        });
      } else {
        await createSecretSource({
          name: form.name,
          baseUrl: form.baseUrl,
          token: form.token,
          shared: form.shared,
        });
      }
      toast.success(t("hosts.secretSourceSaved"));
      setForm(null);
      await reload();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (source: SecretSource) => {
    try {
      await deleteSecretSource(source.id);
      toast.success(t("hosts.secretSourceDeleted"));
      await reload();
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleTest = async (source: SecretSource) => {
    setTesting(source.id);
    try {
      const result = await testSecretSource(source.id);
      if (result.ok) {
        toast.success(
          t("hosts.secretSourceTestOk", { count: result.vaults ?? 0 }),
        );
      } else {
        toast.error(result.error ?? t("hosts.secretSourceTestFailed"));
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 col-span-2 border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("hosts.secretSourcesTitle")}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("hosts.secretSourcesDesc")}
      </p>

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
                      {t("hosts.secretSourceShared")}
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
                {t("hosts.secretSourceTest")}
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
            <Plus className="size-3 mr-1" /> {t("hosts.secretSourceNew")}
          </Button>
        </>
      )}

      {form && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.friendlyNameLabel")}
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
                {t("hosts.secretSourceUrlLabel")}
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
              {t("hosts.secretSourceTokenLabel")}
            </label>
            <PasswordInput
              className="h-8 text-xs pr-8"
              placeholder={
                form.id ? t("hosts.secretSourceTokenKeep") : "eyJhbGciOi..."
              }
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
            {t("hosts.secretSourceSharedLabel")}
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
