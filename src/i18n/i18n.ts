// i18n configuration for multi-language support
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files directly
import enTranslation from '../locales/en/translation.json';
import zhTranslation from '../locales/zh/translation.json';

// Initialize i18n
i18n
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
    
    // Resources - load translations directly
    resources: {
      en: {
        translation: enTranslation
      },
      zh: {
        translation: zhTranslation
      }
    },
    
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    
    react: {
      useSuspense: false, // Disable suspense for SSR compatibility
    },
  });

export default i18n;