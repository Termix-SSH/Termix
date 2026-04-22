import React, { useState, useEffect, useRef, useCallback } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { setCookie } from "@/ui/main-axios.ts";

interface ElectronLoginFormProps {
  serverUrl: string;
  onAuthSuccess: () => void;
  onChangeServer: () => void;
}

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

  const handleAuthToken = useCallback(
    async (token: string) => {
      if (hasAuthenticatedRef.current || isAuthenticatingRef.current) return;
      hasAuthenticatedRef.current = true;
      isAuthenticatingRef.current = true;
      setIsAuthenticating(true);

      try {
        setCookie("jwt", token);
        await new Promise((resolve) => setTimeout(resolve, 300));
        onAuthSuccessRef.current();
      } catch (_err) {
        setError(t("errors.authTokenSaveFailed"));
        isAuthenticatingRef.current = false;
        setIsAuthenticating(false);
        hasAuthenticatedRef.current = false;
      }
    },
    [t],
  );

  // postMessage from server's Auth.tsx (works if server has postMessage code)
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      try {
        if (!event.data || typeof event.data !== "object") return;
        const { type, token, platform } = event.data;
        if (type === "AUTH_SUCCESS" && token && platform === "desktop") {
          await handleAuthToken(token);
        }
      } catch (_err) {
        // ignore
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleAuthToken]);

  // Poll iframe localStorage via main process executeJavaScriptInFrame (bypasses cross-origin)
  useEffect(() => {
    if (loading) return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.invoke) return;

    const poll = setInterval(async () => {
      if (hasAuthenticatedRef.current || isAuthenticatingRef.current) return;
      try {
        const token = await electronAPI.invoke("get-iframe-jwt");
        if (token && token.length > 20) {
          await handleAuthToken(token);
        }
      } catch (_e) {
        // ignore
      }
    }, 500);

    return () => clearInterval(poll);
  }, [loading, handleAuthToken]);

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
      } catch (_e) {
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
    <div className="fixed inset-0 w-screen h-screen bg-canvas flex flex-col">
      {isAuthenticating && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas z-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!isAuthenticating && (
        <div className="flex items-center justify-between p-4 bg-canvas border-b border-edge">
          <button
            onClick={onChangeServer}
            className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-base font-medium">
              {t("serverConfig.changeServer")}
            </span>
          </button>
          {!isEmbeddedServer && (
            <div className="flex-1 mx-4 text-center">
              <span className="text-muted-foreground text-sm truncate block">
                {displayUrl}
              </span>
            </div>
          )}
          {isEmbeddedServer && <div className="flex-1" />}
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
          className="absolute inset-0 flex items-center justify-center bg-canvas z-40"
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
          allow="clipboard-read; clipboard-write; cross-origin-isolated; camera; microphone; geolocation"
        />
      </div>
    </div>
  );
}
