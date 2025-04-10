/**
 * Utility functions for loading fonts on demand
 */

import { loadCSSFromString } from './cssLoader';

// Instead of downloading fonts, we'll use system fonts that are already available
const systemFonts = {
    // Main system monospace fonts available on most platforms
    ubuntuMono: {
        fontFamily: '"Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", "Noto Color Emoji", monospace',
        fallback: 'monospace'
    },
    firaCode: {
        fontFamily: '"Fira Code Nerd Font", "FiraCode Nerd Font", "Fira Code", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    jetBrainsMono: {
        fontFamily: '"JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font", "JetBrains Mono", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    sourceCodePro: {
        fontFamily: '"Source Code Pro Nerd Font", "SourceCodePro Nerd Font", "Source Code Pro", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    cascadiaCode: {
        fontFamily: '"Cascadia Code Nerd Font", "CascadiaCode Nerd Font", "Cascadia Code", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    consolas: {
        fontFamily: '"Consolas Nerd Font", "Consolas", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    menlo: {
        fontFamily: '"Menlo Nerd Font", "Menlo", "Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    },
    monospace: {
        fontFamily: '"Ubuntu Mono Nerd Font", "UbuntuMono Nerd Font", "Ubuntu Mono", monospace',
        fallback: 'monospace'
    }
};

// Better font display names for UI
export const fontDisplayNames = {
    monospace: 'Monospace',
    consolas: 'Consolas',
    firaCode: 'Fira Code',
    jetBrainsMono: 'JetBrains Mono',
    ubuntuMono: 'Ubuntu Mono',
    sourceCodePro: 'Source Code Pro',
    cascadiaCode: 'Cascadia Code',
    menlo: 'Menlo'
};

// Track which fonts have been loaded
const loadedFonts = {
    // Mark all system fonts as loaded by default
    monospace: true,
    consolas: true,
    menlo: true,
    ubuntuMono: true,
    firaCode: true,
    jetBrainsMono: true,
    sourceCodePro: true, 
    cascadiaCode: true
};

// Font characteristics to make them more visually distinct
const fontCustomCSS = `
/* Base terminal font settings */
.xterm {
  font-variant-ligatures: none !important;
  -webkit-font-smoothing: auto !important;
}

/* System fonts */
[style*="font-family: monospace"] {
  letter-spacing: 0 !important;
  -webkit-font-smoothing: auto !important;
}

[style*="font-family: 'Consolas'"],
[style*="font-family: Consolas"] {
  letter-spacing: 0.01em !important;
  -webkit-font-smoothing: subpixel-antialiased !important;
}

[style*="font-family: 'Menlo'"],
[style*="font-family: Menlo"] {
  letter-spacing: 0.025em !important;
  -webkit-font-smoothing: antialiased !important;
}

/* Ubuntu Mono - rounder, friendly */
[style*="font-family: 'Ubuntu Mono'"],
[style*="font-family: Ubuntu Mono"] {
  letter-spacing: 0.04em !important;
  font-variant-ligatures: no-contextual !important;
  -webkit-font-smoothing: antialiased !important;
}

/* Fira Code - modern, sharp */
[style*="font-family: 'Fira Code'"],
[style*="font-family: Fira Code"] {
  letter-spacing: 0.02em !important;
  font-variant-ligatures: no-contextual !important;
  -webkit-font-smoothing: subpixel-antialiased !important;
}

/* JetBrains Mono - squarish, distinct */
[style*="font-family: 'JetBrains Mono'"],
[style*="font-family: JetBrains Mono"] {
  letter-spacing: 0.03em !important;
  font-variant-ligatures: no-contextual !important;
  -webkit-font-smoothing: antialiased !important;
}

/* Source Code Pro - clean, professional */
[style*="font-family: 'Source Code Pro'"],
[style*="font-family: Source Code Pro"] {
  letter-spacing: 0.025em !important;
  font-variant-ligatures: no-contextual !important;
  -webkit-font-smoothing: subpixel-antialiased !important;
}

/* Cascadia Code - very distinctive */
[style*="font-family: 'Cascadia Code'"],
[style*="font-family: Cascadia Code"] {
  letter-spacing: 0.015em !important;
  font-variant-ligatures: no-contextual !important;
  -webkit-font-smoothing: antialiased !important;
}

/* Bold text should be extra bold to be visible */
.xterm-bold {
  font-weight: 700 !important;
}
`;

// Add our custom CSS to the document
try {
    loadCSSFromString(fontCustomCSS);
} catch (err) {
}

/**
 * Get a formatted font family string for use in CSS
 * @param {string} fontName - The internal font name (e.g., 'ubuntuMono')
 * @returns {string} CSS-ready font-family string
 */
export const getFormattedFontFamily = (fontName) => {
    // Fallback to system monospace if the font isn't found
    if (!fontName || !systemFonts[fontName]) {
        return 'monospace';
    }
    
    // Return the appropriate font family string
    return systemFonts[fontName].fontFamily;
};

/**
 * Load a font for use in the terminal
 * No actual loading occurs - all fonts are system fonts
 * @param {string} fontFamily - The font family internal name
 * @param {string} weight - Font weight (ignored)
 */
export const loadFont = (fontFamily) => {
    // All fonts are treated as system fonts
    return Promise.resolve();
};

/**
 * Preload all available fonts
 * This is a no-op since we're using system fonts
 */
export const preloadAllFonts = () => {
    // Nothing to preload
    return Promise.resolve();
};

// Export methods
export default {
    loadFont,
    preloadAllFonts,
    getFormattedFontFamily,
    fontDisplayNames
}; 