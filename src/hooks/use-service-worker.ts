import { useEffect, useState, useCallback } from "react";
import { isElectron } from "@/ui/main-axios";

interface ServiceWorkerState {
    isSupported: boolean;
    isRegistered: boolean;
    updateAvailable: boolean;
}

/**
 * Hook to manage PWA Service Worker registration.
 * Only registers in production web environment (not in Electron).
 */
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
                    console.log("[SW] Update available");
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

        const registerSW = async () => {
            try {
                const registration = await navigator.serviceWorker.register("/sw.js");
                console.log("[SW] Registered:", registration.scope);

                setState((prev) => ({ ...prev, isRegistered: true }));

                registration.addEventListener("updatefound", () =>
                    handleUpdateFound(registration),
                );
            } catch (error) {
                console.error("[SW] Registration failed:", error);
            }
        };

        if (document.readyState === "complete") {
            registerSW();
        } else {
            window.addEventListener("load", registerSW);
            return () => window.removeEventListener("load", registerSW);
        }
    }, [handleUpdateFound]);

    return state;
}
