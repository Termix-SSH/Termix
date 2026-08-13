import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import {
  createAiProvider,
  deleteAiProvider,
  probeAiModels,
  type AiProvider,
  type AiProviderType,
} from "@/api/ai-api";

const PROVIDER_TYPES: Array<{
  value: AiProviderType;
  labelKey: string;
  needsBaseUrl: boolean;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
}> = [
  {
    value: "ollama",
    labelKey: "ai.providerOllama",
    needsBaseUrl: true,
    needsApiKey: false,
    defaultBaseUrl: "http://localhost:11434",
  },
  {
    value: "anthropic",
    labelKey: "ai.providerAnthropic",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "openai",
    labelKey: "ai.providerOpenai",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "gemini",
    labelKey: "ai.providerGemini",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "openai_compatible",
    labelKey: "ai.providerOpenaiCompatible",
    needsBaseUrl: true,
    needsApiKey: false,
  },
];

interface AiProviderSettingsProps {
  providers: AiProvider[];
  /** selectId names a provider that should become the active one. */
  onChanged: (selectId?: number) => void;
  onAdded?: () => void;
}

export function AiProviderSettings({
  providers,
  onChanged,
  onAdded,
}: AiProviderSettingsProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerType, setProviderType] = useState<AiProviderType>("ollama");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  const [models, setModels] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectWarning, setDetectWarning] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);

  const spec = PROVIDER_TYPES.find((entry) => entry.value === providerType)!;

  useEffect(() => {
    setBaseUrl(spec.defaultBaseUrl ?? "");
    setApiKey("");
    setModels([]);
    setDefaultModel("");
    setCustomModel(false);
    setDetectWarning(null);
  }, [providerType, spec.defaultBaseUrl]);

  /**
   * Fetches the provider's own model list so nobody has to go and look model
   * names up. Falls back to a curated list when the endpoint is unreachable,
   * and a free-text field is always available for anything not listed.
   */
  const detectModels = useCallback(async () => {
    setDetecting(true);
    setDetectWarning(null);
    try {
      const result = await probeAiModels({
        providerType,
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
      });
      setModels(result.models);
      if (result.source === "fallback") {
        setDetectWarning(t("ai.modelDetectFailed"));
      }
      // Pick the first suggestion so the field is never left empty.
      setDefaultModel((current) => current || result.models[0] || "");
    } catch {
      setDetectWarning(t("ai.modelDetectFailed"));
    } finally {
      setDetecting(false);
    }
  }, [providerType, baseUrl, apiKey, t]);

  // Detect as soon as the provider has enough detail to be reachable.
  useEffect(() => {
    if (!adding) return;
    const ready = spec.needsApiKey ? apiKey.trim().length > 0 : true;
    if (!ready) return;
    const timer = setTimeout(() => void detectModels(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, providerType, baseUrl, apiKey]);

  async function handleAdd() {
    if (!label.trim()) {
      toast.error(t("ai.labelRequired"));
      return;
    }
    setSaving(true);
    try {
      const created = await createAiProvider({
        providerType,
        label: label.trim(),
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
        defaultModel: defaultModel.trim() || null,
      });
      setAdding(false);
      setLabel("");
      setApiKey("");
      setDefaultModel("");
      onChanged(created.id);
      onAdded?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ai.providerSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAiProvider(id);
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("ai.providerDeleteFailed"),
      );
    }
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <div
          key={provider.id}
          className="flex items-center justify-between gap-2 rounded-none border border-border bg-muted px-3 py-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{provider.label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {provider.providerType}
              {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
              {provider.apiKeyPrefix ? ` · ${provider.apiKeyPrefix}…` : ""}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDelete(provider.id)}
            aria-label={t("ai.removeProvider")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}

      {!adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus size={14} />
          {t("ai.addProvider")}
        </Button>
      )}

      {adding && (
        <div className="space-y-3 rounded-none border border-border p-3">
          <div className="space-y-1.5">
            <Label>{t("ai.providerType")}</Label>
            <Select
              value={providerType}
              onValueChange={(value) =>
                setProviderType(value as AiProviderType)
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {t(entry.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("ai.providerLabel")}</Label>
            <Input
              className="rounded-none"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("ai.providerLabelPlaceholder")}
            />
          </div>

          {spec.needsBaseUrl && (
            <div className="space-y-1.5">
              <Label>{t("ai.baseUrl")}</Label>
              <Input
                className="rounded-none"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://localhost:11434"
              />
              <p className="text-xs text-muted-foreground">
                {t("ai.privateEndpointHint")}
              </p>
            </div>
          )}

          {(spec.needsApiKey || providerType === "openai_compatible") && (
            <div className="space-y-1.5">
              <Label>{t("ai.apiKey")}</Label>
              <Input
                className="rounded-none"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="min-w-0 flex-1">{t("ai.defaultModel")}</Label>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => void detectModels()}
                disabled={detecting}
              >
                {detecting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                {t("ai.modelRefresh")}
              </button>
            </div>

            {models.length > 0 && !customModel ? (
              <Select
                value={defaultModel || undefined}
                onValueChange={(value) => {
                  if (value === "__custom__") {
                    setCustomModel(true);
                    setDefaultModel("");
                    return;
                  }
                  setDefaultModel(value);
                }}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue placeholder={t("ai.modelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                  {/* Anything the provider did not list is still reachable. */}
                  <SelectItem value="__custom__">
                    {t("ai.modelCustom")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="rounded-none"
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                placeholder={t("ai.defaultModelPlaceholder")}
              />
            )}

            {detectWarning && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {detectWarning}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={handleAdd}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t("ai.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setAdding(false)}
            >
              {t("ai.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
