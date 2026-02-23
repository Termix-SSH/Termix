import { useState, useEffect, useRef } from "react";
import type { NLUIEngine } from "./engine/types";
import { createEngine } from "./engine/engine";
import { LocalStorageAdapter } from "./engine/conversation/storage";
import { getLLMConfigKey } from "@/ui/main-axios";

/**
 * React hook that initializes the NLUI engine with Termix backend config.
 * Fetches LLM config from the backend and creates an engine targeting the Termix API.
 */
export function useAIEngine() {
  const [engine, setEngine] = useState<NLUIEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        const config = await getLLMConfigKey();

        if (!config.apiBase || !config.apiKey) {
          setError("noConfig");
          setLoading(false);
          return;
        }

        // Determine the backend base URL from current page location
        const backendBase = `${window.location.protocol}//${window.location.hostname}:30001`;

        const eng = await createEngine({
          llm: {
            apiBase: config.apiBase,
            apiKey: config.apiKey,
            model: config.model || "gpt-4o",
            stream: config.stream ?? true,
          },
          targets: [
            {
              name: "termix",
              baseURL: backendBase,
              spec: `${backendBase}/openapi.json`,
              auth: { type: "bearer" },
              description: "Termix SSH Server Manager API — manages SSH hosts, credentials, tunnels, file operations, Docker containers, and server monitoring.",
            },
          ],
          language: (config.language as "zh" | "en" | "ja") || "en",
          storage: new LocalStorageAdapter("termix_ai_"),
        });

        setEngine(eng);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize AI engine");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { engine, loading, error };
}
