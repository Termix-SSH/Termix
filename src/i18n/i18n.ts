// i18n configuration for multi-language support
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpApi from 'i18next-http-backend';

// Initialize i18n
i18n
  .use(HttpApi) // Load translations using http
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    supportedLngs: ['en', 'zh'], // Supported languages
    fallbackLng: 'en', // Fallback language
    debug: false,
    
    // Detection options - disabled to always use English by default
    detection: {
      order: ['localStorage', 'cookie'], // Only check user's saved preference
      caches: ['localStorage', 'cookie'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18nextLng',
      checkWhitelist: true,
    },
    
    // Backend options
    backend: {
      loadPath: './locales/{{lng}}/translation.json',
    },
    
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    react: {
      useSuspense: false, // Disable suspense for SSR compatibility
    },
  });

export default i18n;