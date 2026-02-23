import React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Loader2, Zap } from "lucide-react";
import { getLLMConfig, updateLLMConfig } from "@/ui/main-axios.ts";

export function AISettingsTab(): React.ReactElement {
  const { t } = useTranslation();
  const [apiBase, setApiBase] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [apiKeyMasked, setApiKeyMasked] = React.useState("");
  const [model, setModel] = React.useState("");
  const [stream, setStream] = React.useState(true);
  const [language, setLanguage] = React.useState("en");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    getLLMConfig()
      .then((config) => {
        setApiBase(config.apiBase || "");
        setApiKeyMasked(config.apiKeyMasked || "");
        setModel(config.model || "");
        setStream(config.stream ?? true);
        setLanguage(config.language || "en");
      })
      .catch(() => {
        // silently use defaults
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: Record<string, unknown> = {
        apiBase,
        model,
        stream,
        language,
      };
      if (apiKey) {
        config.apiKey = apiKey;
      }
      const result = await updateLLMConfig(config);
      setApiKeyMasked(result.apiKeyMasked || "");
      setApiKey("");
      toast.success(t("admin.llmSaved"));
    } catch {
      toast.error(t("admin.llmSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!apiBase) {
      toast.error(t("admin.llmTestNoBase"));
      return;
    }
    setTesting(true);
    try {
      const base = apiBase.replace(/\/+$/, "");
      const headers: Record<string, string> = {};
      const testKey = apiKey || "";
      if (testKey) {
        headers["Authorization"] = `Bearer ${testKey}`;
      }
      const resp = await fetch(`${base}/models`, { headers });
      if (resp.ok) {
        toast.success(t("admin.llmTestSuccess"));
      } else {
        const text = await resp.text();
        toast.error(`${t("admin.llmTestFailed")}: HTTP ${resp.status} - ${text.slice(0, 100)}`);
      }
    } catch (err) {
      toast.error(`${t("admin.llmTestFailed")}: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">{t("admin.aiAssistant")}</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("admin.aiDescription")}
        </p>

        <div className="grid gap-4 max-w-lg">
          <div className="space-y-2">
            <Label>{t("admin.llmApiBase")}</Label>
            <Input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("admin.llmApiKey")}</Label>
            <PasswordInput
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyMasked || "sk-..."}
            />
            {apiKeyMasked && !apiKey && (
              <p className="text-xs text-muted-foreground">
                {t("admin.llmApiKeySet")}: {apiKeyMasked}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("admin.llmModel")}</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("admin.llmLanguage")}</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="ja">日本語</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2">
            <Checkbox
              checked={stream}
              onCheckedChange={(checked) => setStream(!!checked)}
            />
            <span className="text-sm">{t("admin.llmStream")}</span>
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("admin.updateSettings")}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("admin.llmTestConnection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
