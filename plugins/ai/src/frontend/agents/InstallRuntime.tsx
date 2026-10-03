import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";
import { Download, Network } from "lucide-react";
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
  async function install(operation: "install" | "forwarding") {
    const failed =
      operation === "install"
        ? "agents.installFailed"
        : "agents.forwardingFailed";
    setBusy(true);
    setLog("");
    setResult("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await aiApp().fetch(`agents/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, agent }),
        signal: controller.signal,
      });
      if (!response.ok) throw Error((await response.json()).error || t(failed));
      if (!response.body) throw Error(t(failed));
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
            if (!event.success) throw Error(event.error || t(failed));
            setResult(
              t(
                operation === "install"
                  ? "agents.installSucceeded"
                  : "agents.forwardingSucceeded",
              ),
            );
          }
        }
      }
      if (!completed) throw Error(t(failed));
    } catch (error) {
      if (!controller.signal.aborted)
        setResult(error instanceof Error ? error.message : t(failed));
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
        onClick={() => void install("install")}
      >
        <Download size={14} />
        {t("agents.installRuntime")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t("agents.forwardingScope")}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void install("forwarding")}
      >
        <Network size={14} />
        {t("agents.enableForwarding")}
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
