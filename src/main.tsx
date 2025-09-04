import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import { useMediaQuery } from "react-responsive";
import './index.css'
import DesktopApp from './ui/Desktop/DesktopApp.tsx'
import MobileApp from './ui/Mobile/MobileApp.tsx'
import {ThemeProvider} from "@/components/theme-provider"
import './i18n/i18n'


function RootApp() {
    const isMobile = useMediaQuery({ maxWidth: 767 });

    return (
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            {isMobile ? <MobileApp /> : <DesktopApp />}
        </ThemeProvider>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <RootApp />
    </StrictMode>
);