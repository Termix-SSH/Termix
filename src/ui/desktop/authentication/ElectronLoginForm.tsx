import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { getCookie } from "@/ui/main-axios.ts";

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
  const [currentUrl, setCurrentUrl] = useState(serverUrl);
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
            } catch (err) {
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
        if (iframe.contentWindow) {
          setCurrentUrl(iframe.contentWindow.location.href);
        }
      } catch (e) {
        setCurrentUrl(serverUrl);
      }

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
            } catch (evalError) {
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

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = serverUrl;
      setLoading(true);
      setError(null);
    }
  };

  const handleBack = () => {
    onChangeServer();
  };

  const displayUrl = currentUrl.replace(/^https?:\/\//, "");

  return (
    <div className="fixed inset-0 w-screen h-screen bg-dark-bg flex flex-col">
      <div className="flex items-center justify-between p-4 bg-dark-bg border-b border-dark-border">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
          disabled={isAuthenticating}
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="text-base font-medium">
            {t("serverConfig.changeServer")}
          </span>
        </button>
        <div className="flex-1 mx-4 text-center">
          <span className="text-muted-foreground text-sm truncate block">
            {displayUrl}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="p-2 text-foreground hover:text-primary transition-colors"
          disabled={loading || isAuthenticating}
        >
          <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-dark-bg z-40"
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

      <div className="flex-1 overflow-hidden">
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
