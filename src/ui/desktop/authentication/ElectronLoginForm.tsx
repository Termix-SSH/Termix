import React, { useState, useEffect, useRef, useCallback } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";

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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hasAuthenticatedRef = useRef(false);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    localStorage.removeItem("jwt");
  }, []);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      try {
        const serverOrigin = new URL(serverUrl).origin;
        if (event.origin !== serverOrigin) {
          return;
        }

        if (event.data && typeof event.data === "object") {
          const data = event.data;

          if (
            data.type === "AUTH_SUCCESS" &&
            data.token &&
            !hasAuthenticatedRef.current &&
            !isAuthenticating
          ) {
            hasAuthenticatedRef.current = true;
            setIsAuthenticating(true);

            try {
              localStorage.setItem("jwt", data.token);

              const savedToken = localStorage.getItem("jwt");
              if (!savedToken) {
                throw new Error("Failed to save JWT to localStorage");
              }

              await new Promise((resolve) => setTimeout(resolve, 500));

              onAuthSuccess();
            } catch {
              setError(t("errors.authTokenSaveFailed"));
              setIsAuthenticating(false);
              hasAuthenticatedRef.current = false;
            }
          }
        }
      } catch (err) {
        console.error("Authentication operation failed:", err);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [serverUrl, isAuthenticating, onAuthSuccess, t]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setLoading(false);
      hasLoadedOnce.current = true;
      setError(null);

      try {
        const injectedScript = `
          (function() {
            let hasNotified = false;

            function postJWTToParent(token, source) {
              if (hasNotified) {
                return;
              }
              hasNotified = true;

              try {
                window.parent.postMessage({
                  type: 'AUTH_SUCCESS',
                  token: token,
                  source: source,
                  platform: 'desktop',
                  timestamp: Date.now()
                }, '*');
              } catch (e) {
              }
            }

            function checkAuth() {
              try {
                const localToken = localStorage.getItem('jwt');
                if (localToken && localToken.length > 20) {
                  postJWTToParent(localToken, 'localStorage');
                  return true;
                }

                const sessionToken = sessionStorage.getItem('jwt');
                if (sessionToken && sessionToken.length > 20) {
                  postJWTToParent(sessionToken, 'sessionStorage');
                  return true;
                }

                const cookies = document.cookie;
                if (cookies && cookies.length > 0) {
                  const cookieArray = cookies.split('; ');
                  const tokenCookie = cookieArray.find(row => row.startsWith('jwt='));

                  if (tokenCookie) {
                    const token = tokenCookie.split('=')[1];
                    if (token && token.length > 20) {
                      postJWTToParent(token, 'cookie');
                      return true;
                    }
                  }
                }
              } catch (error) {
              }
              return false;
            }

            const originalSetItem = localStorage.setItem;
            localStorage.setItem = function(key, value) {
              originalSetItem.apply(this, arguments);
              if (key === 'jwt' && value && value.length > 20 && !hasNotified) {
                setTimeout(() => checkAuth(), 100);
              }
            };

            const originalSessionSetItem = sessionStorage.setItem;
            sessionStorage.setItem = function(key, value) {
              originalSessionSetItem.apply(this, arguments);
              if (key === 'jwt' && value && value.length > 20 && !hasNotified) {
                setTimeout(() => checkAuth(), 100);
              }
            };

            const intervalId = setInterval(() => {
              if (hasNotified) {
                clearInterval(intervalId);
                return;
              }
              if (checkAuth()) {
                clearInterval(intervalId);
              }
            }, 500);

            setTimeout(() => {
              clearInterval(intervalId);
            }, 300000);

            setTimeout(() => checkAuth(), 500);
          })();
        `;

        try {
          if (iframe.contentWindow) {
            try {
              iframe.contentWindow.eval(injectedScript);
            } catch {
              iframe.contentWindow.postMessage(
                { type: "INJECT_SCRIPT", script: injectedScript },
                "*",
              );
            }
          }
        } catch (err) {
          console.error("Authentication operation failed:", err);
        }
      } catch (err) {
        console.error("Authentication operation failed:", err);
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
  }, [t]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = serverUrl;
      setLoading(true);
      setError(null);
    }
  }, [serverUrl]);

  useEffect(() => {
    const electronApi = window.electronAPI;
    if (!electronApi?.setMenuContext || !electronApi?.onMenuAction) {
      return;
    }

    electronApi.setMenuContext({
      remoteAuthActive: true,
      canReloadRemoteAuth: true,
    });

    const unsubscribe = electronApi.onMenuAction((action) => {
      if (action === "reload-remote-auth") {
        handleRefresh();
      } else if (action === "change-server") {
        onChangeServer();
      }
    });

    return () => {
      unsubscribe?.();
      electronApi.setMenuContext({
        remoteAuthActive: false,
        canReloadRemoteAuth: false,
      });
    };
  }, [handleRefresh, onChangeServer]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center px-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-canvas/95 backdrop-blur-sm">
          <div className="flex items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">
              {t("auth.loadingServer")}
            </span>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={serverUrl}
        className="h-full w-full border-0"
        title="Server Authentication"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation allow-top-navigation allow-top-navigation-by-user-activation allow-modals allow-downloads"
        allow="clipboard-read; clipboard-write; cross-origin-isolated; camera; microphone; geolocation"
      />
    </div>
  );
}
