import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";
import { Download } from "lucide-react";
import { aiApp } from "../app-ref";
import type { AgentKind } from "../../backend/agents/types";

export function InstallRuntime({
  hostId,
  agent,
  busy,
  setBusy,
}: {
  hostId: number;
  agent: AgentKind;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [log, setLog] = useState("");
  const [result, setResult] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function install() {
    setBusy(true);
    setLog("");
    setResult("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await aiApp().fetch("agents/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, agent }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error((await response.json()).error || t("agents.installFailed"));
      if (!response.body) throw Error(t("agents.installFailed"));
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        completed = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let n: number;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, n));
          buffer = buffer.slice(n + 1);
          if (event.log) setLog((old) => (old + event.log).slice(-64000));
          if (event.done) {
            completed = true;
            if (!event.success)
              throw Error(event.error || t("agents.installFailed"));
            setResult(t("agents.installSucceeded"));
          }
        }
      }
      if (!completed) throw Error(t("agents.installFailed"));
    } catch (error) {
      if (!controller.signal.aborted)
        setResult(
          error instanceof Error ? error.message : t("agents.installFailed"),
        );
    } finally {
      request.current = null;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded border p-3">
      <p className="text-xs text-muted-foreground">
        {t("agents.installSource")}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void install()}
      >
        <Download size={14} />
        {t("agents.installRuntime")}
      </Button>
      {result && (
        <p role="status" className="text-sm">
          {result}
        </p>
      )}
      {log && (
        <pre
          aria-label={t("agents.installLog")}
          className="max-h-48 overflow-auto whitespace-pre-wrap text-xs"
        >
          {log}
        </pre>
      )}
    </div>
  );
}
