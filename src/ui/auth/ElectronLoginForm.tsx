import React, { useState, useEffect, useRef, useCallback } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/alert.tsx";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";

interface ElectronLoginFormProps {
  serverUrl: string;
  onAuthSuccess: (token: string | null) => void | Promise<void>;
  onChangeServer: () => void;
}

const AUTH_MESSAGE_SOURCES = new Set([
  "auth_component",
  "totp_auth_component",
  "oidc_callback",
]);

export function ElectronLoginForm({
  serverUrl,
  onAuthSuccess,
  onChangeServer,
}: ElectronLoginFormProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isAuthenticatingRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hasAuthenticatedRef = useRef(false);
  const [currentUrl, setCurrentUrl] = useState(serverUrl);
  const hasLoadedOnce = useRef(false);
  const onAuthSuccessRef = useRef(onAuthSuccess);
  useEffect(() => {
    onAuthSuccessRef.current = onAuthSuccess;
  }, [onAuthSuccess]);

  const handleAuthSuccess = useCallback(
    async (token: string | null) => {
      if (hasAuthenticatedRef.current || isAuthenticatingRef.current) return;
      hasAuthenticatedRef.current = true;
      isAuthenticatingRef.current = true;
      setIsAuthenticating(true);

      try {
        if (token) {
          localStorage.setItem("jwt", token);
        }
        await onAuthSuccessRef.current(token);
      } catch {
        setError(t("errors.authTokenSaveFailed"));
        isAuthenticatingRef.current = false;
        setIsAuthenticating(false);
        hasAuthenticatedRef.current = false;
      }
    },
    [t],
  );

  // postMessage from server Auth.tsx after the backend has set the HttpOnly cookie.
  // Uses '*' as target origin because the iframe may be cross-origin (e.g. remote Docker server).
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      try {
        if (event.source !== iframeRef.current?.contentWindow) return;
        if (!event.data || typeof event.data !== "object") return;
        const { type, platform, source, token, authUrl, callbackPort } =
          event.data;

        if (
          type === "AUTH_SUCCESS" &&
          platform === "desktop" &&
          AUTH_MESSAGE_SOURCES.has(source)
        ) {
          await handleAuthSuccess(token ?? null);
          return;
        }

        // OIDC login requested from inside the iframe — open the system browser
        // so captcha stages (e.g. Cloudflare Turnstile) render correctly.
        if (type === "OIDC_SYSTEM_BROWSER_AUTH" && authUrl && callbackPort) {
          const electronAPI = (
            window as unknown as {
              electronAPI?: {
                oidcSystemBrowserAuth?: (
                  url: string,
                  port: number,
                ) => Promise<{
                  success: boolean;
                  token?: string;
                  error?: string;
                }>;
              };
            }
          ).electronAPI;
          if (!electronAPI?.oidcSystemBrowserAuth) return;
          const result = await electronAPI.oidcSystemBrowserAuth(
            authUrl,
            callbackPort,
          );
          if (result.success && result.token) {
            await handleAuthSuccess(result.token);
          }
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleAuthSuccess]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setLoading(false);
      hasLoadedOnce.current = true;
      setError(null);

      try {
        if (iframe.contentWindow) {
          setCurrentUrl(iframe.contentWindow.location.href);
        }
      } catch {
        setCurrentUrl(serverUrl);
      }
    };

    const handleError = () => {
      setLoading(false);
      if (hasLoadedOnce.current) {
        setError(t("errors.failedToLoadServer"));
      }
    };

    iframe.addEventListener("load", handleLoad);
    iframe.addEventListener("error", handleError);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
  }, [serverUrl, t]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = serverUrl;
      setLoading(true);
      setError(null);
    }
  };

  const displayUrl = currentUrl.replace(/^https?:\/\//, "");
  const isEmbeddedServer = serverUrl.includes("localhost:30001");

  return (
    <div className="fixed inset-0 w-screen h-screen bg-background flex flex-col">
      {isAuthenticating && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!isAuthenticating && (
        <div className="flex items-center justify-between p-4 bg-background border-b border-border">
          <button
            onClick={onChangeServer}
            className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-base font-medium">
              {t("serverConfig.changeServer")}
            </span>
          </button>
          <div className="flex-1 mx-4 text-center">
            <span className="text-muted-foreground text-sm truncate block">
              {isEmbeddedServer ? t("serverConfig.localServer") : displayUrl}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 text-foreground hover:text-primary transition-colors"
            disabled={loading}
          >
            <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      )}

      {error && !isAuthenticating && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {loading && !isAuthenticating && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background z-40"
          style={{ marginTop: "60px" }}
        >
          <div className="flex items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">
              {t("auth.loadingServer")}
            </span>
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-hidden"
        style={{ visibility: isAuthenticating ? "hidden" : "visible" }}
      >
        <iframe
          ref={iframeRef}
          src={serverUrl}
          className="w-full h-full border-0"
          title="Server Authentication"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation allow-top-navigation allow-top-navigation-by-user-activation allow-modals allow-downloads"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
