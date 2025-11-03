import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { getCookie, getUserInfo } from "@/ui/main-axios.ts";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        ref?: React.Ref<any>;
      };
    }
  }
}

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
  const webviewRef = useRef<any>(null);
  const hasAuthenticatedRef = useRef(false);
  const [currentUrl, setCurrentUrl] = useState(serverUrl);
  const hasLoadedOnce = useRef(false);
  const urlCheckInterval = useRef<NodeJS.Timeout | null>(null);
  const loadTimeout = useRef<NodeJS.Timeout | null>(null);

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

              try {
                await getUserInfo();
              } catch (verifyErr) {
                localStorage.removeItem("jwt");
                const errorMsg =
                  verifyErr instanceof Error
                    ? verifyErr.message
                    : "Failed to verify authentication";
                console.error("Authentication verification failed:", verifyErr);
                throw new Error(
                  errorMsg.includes("registration") ||
                  errorMsg.includes("allowed")
                    ? "Authentication failed. Please check your server connection and try again."
                    : errorMsg,
                );
              }

              await new Promise((resolve) => setTimeout(resolve, 500));

              onAuthSuccess();
            } catch (err) {
              const errorMessage =
                err instanceof Error
                  ? err.message
                  : t("errors.authTokenSaveFailed");
              setError(errorMessage);
              setIsAuthenticating(false);
              hasAuthenticatedRef.current = false;
            }
          }
        }
      } catch (err) {}
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [serverUrl, isAuthenticating, onAuthSuccess, t]);

  useEffect(() => {
    const checkWebviewUrl = () => {
      const webview = webviewRef.current;
      if (!webview) return;

      try {
        const webviewUrl = webview.getURL();
        if (webviewUrl && webviewUrl !== currentUrl) {
          setCurrentUrl(webviewUrl);
        }
      } catch (e) {}
    };

    urlCheckInterval.current = setInterval(checkWebviewUrl, 500);

    return () => {
      if (urlCheckInterval.current) {
        clearInterval(urlCheckInterval.current);
        urlCheckInterval.current = null;
      }
    };
  }, [currentUrl]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    loadTimeout.current = setTimeout(() => {
      if (!hasLoadedOnce.current && loading) {
        setLoading(false);
        setError(
          "Unable to connect to server. Please check the server URL and try again.",
        );
      }
    }, 15000);

    const handleLoad = () => {
      if (loadTimeout.current) {
        clearTimeout(loadTimeout.current);
        loadTimeout.current = null;
      }

      setLoading(false);
      hasLoadedOnce.current = true;
      setError(null);

      try {
        const webviewUrl = webview.getURL();
        setCurrentUrl(webviewUrl || serverUrl);
      } catch (e) {
        setCurrentUrl(serverUrl);
      }

      const injectedScript = `
        (function() {
          window.IS_ELECTRON = true;
          window.IS_ELECTRON_WEBVIEW = true;
          if (typeof window.electronAPI === 'undefined') {
            window.electronAPI = { isElectron: true };
          }

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

          function clearAuthData() {
            try {
              localStorage.removeItem('jwt');
              sessionStorage.removeItem('jwt');

              const cookies = document.cookie.split(';');
              for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i];
                const eqPos = cookie.indexOf('=');
                const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
                if (name === 'jwt') {
                  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
                  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + window.location.hostname;
                }
              }
            } catch (error) {
            }
          }

          window.addEventListener('message', function(event) {
            try {
              if (event.data && typeof event.data === 'object') {
                if (event.data.type === 'CLEAR_AUTH_DATA') {
                  clearAuthData();
                }
              }
            } catch (error) {
            }
          });

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
        webview.executeJavaScript(injectedScript);
      } catch (err) {
        console.error("Failed to inject authentication script:", err);
      }
    };

    const handleError = () => {
      setLoading(false);
      if (hasLoadedOnce.current) {
        setError(t("errors.failedToLoadServer"));
      }
    };

    webview.addEventListener("did-finish-load", handleLoad);
    webview.addEventListener("did-fail-load", handleError);

    return () => {
      webview.removeEventListener("did-finish-load", handleLoad);
      webview.removeEventListener("did-fail-load", handleError);
      if (loadTimeout.current) {
        clearTimeout(loadTimeout.current);
        loadTimeout.current = null;
      }
    };
  }, [t, loading, serverUrl]);

  const handleRefresh = () => {
    if (webviewRef.current) {
      if (loadTimeout.current) {
        clearTimeout(loadTimeout.current);
        loadTimeout.current = null;
      }

      webviewRef.current.src = serverUrl;
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

      {isAuthenticating && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-dark-bg/80 z-40"
          style={{ marginTop: "60px" }}
        >
          <div className="flex items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">
              {t("auth.authenticating")}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <webview
          ref={webviewRef}
          src={serverUrl}
          className="w-full h-full border-0"
          partition="persist:termix"
          allowpopups="false"
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
