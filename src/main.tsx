/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import DesktopApp from "@/ui/desktop/DesktopApp.tsx";
import { MobileApp } from "@/ui/mobile/MobileApp.tsx";
import { ThemeProvider } from "@/components/theme-provider";
import "./i18n/i18n";
import { isElectron } from "./ui/main-axios.ts";

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  const lastSwitchTime = useRef(0);
  const isCurrentlyMobile = useRef(window.innerWidth < 768);
  const hasSwitchedOnce = useRef(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newIsMobile = newWidth < 768;
        const now = Date.now();

        if (hasSwitchedOnce.current && now - lastSwitchTime.current < 10000) {
          setWidth(newWidth);
          return;
        }

        if (
          newIsMobile !== isCurrentlyMobile.current &&
          now - lastSwitchTime.current > 5000
        ) {
          lastSwitchTime.current = now;
          isCurrentlyMobile.current = newIsMobile;
          hasSwitchedOnce.current = true;
          setWidth(newWidth);
        } else {
          setWidth(newWidth);
        }
      }, 2000);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return width;
}

function RootApp() {
  const width = useWindowWidth();
  const isMobile = width < 768;

  const userAgent =
    navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isTermixMobile = /Termix-Mobile/.test(userAgent);

  if (isElectron()) {
    return <DesktopApp />;
  }

  if (isTermixMobile) {
    return <MobileApp key="mobile" />;
  }

  return isMobile ? <MobileApp key="mobile" /> : <DesktopApp key="desktop" />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <RootApp />
    </ThemeProvider>
  </StrictMode>,
);
