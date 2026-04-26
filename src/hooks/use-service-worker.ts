import { useEffect, useState, useCallback } from "react";
import { isElectron } from "@/lib/electron";
import { getBasePath } from "@/lib/base-path";

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  updateAvailable: boolean;
}

export function useServiceWorker(): ServiceWorkerState {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    updateAvailable: false,
  });

  const handleUpdateFound = useCallback(
    (registration: ServiceWorkerRegistration) => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          setState((prev) => ({ ...prev, updateAvailable: true }));
        }
      });
    },
    [],
  );

  useEffect(() => {
    const isSupported =
      "serviceWorker" in navigator && !isElectron() && import.meta.env.PROD;

    setState((prev) => ({ ...prev, isSupported }));

    if (!isSupported) return;

    const shouldReloadOnControllerChange = Boolean(
      navigator.serviceWorker.controller,
    );
    let hasReloadedForUpdate = false;
    const handleControllerChange = () => {
      if (!shouldReloadOnControllerChange || hasReloadedForUpdate) {
        return;
      }

      hasReloadedForUpdate = true;
      window.location.reload();
    };

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${getBasePath()}/sw.js`,
          { updateViaCache: "none" },
        );
        setState((prev) => ({ ...prev, isRegistered: true }));

        registration.addEventListener("updatefound", () =>
          handleUpdateFound(registration),
        );
        await registration.update();
      } catch (error) {
        console.error("[SW] Registration failed:", error);
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
    }

    return () => {
      window.removeEventListener("load", registerSW);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, [handleUpdateFound]);

  return state;
}
