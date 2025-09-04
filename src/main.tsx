import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import './index.css'
import DesktopApp from './ui/Desktop/DesktopApp.tsx'
import {ThemeProvider} from "@/components/theme-provider"
import './i18n/i18n' // Initialize i18n

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
            <DesktopApp/>
        </ThemeProvider>
    </StrictMode>,
)
