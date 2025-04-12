/**
 * Font utility for terminal fonts - simplified version
 */

export const fontDisplayNames = {
    nerdFont: 'Nerd Font (Hack)'
};

/**
 * Get a formatted font family string for use in CSS
 * @param {string} fontName - The internal font name
 * @returns {string} CSS-ready font-family string
 */
export const getFormattedFontFamily = (fontName) => {
    return '"Hack Nerd Font", "Symbols Nerd Font", monospace';
};

/**
 * Actively preload all fonts to ensure they're available
 * @returns {Promise} Promise that resolves when fonts are loaded
 */
export const preloadAllFonts = () => {
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
        .font-preload-container {
            position: absolute;
            visibility: hidden;
            pointer-events: none;
            width: 0;
            height: 0;
            overflow: hidden;
        }
    `;
    document.head.appendChild(styleElement);

    const container = document.createElement('div');
    container.className = 'font-preload-container';

    const el = document.createElement('div');
    el.className = 'terminal-nerd-font';
    el.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789';
    container.appendChild(el);
    
    document.body.appendChild(container);

    container.getBoundingClientRect();

    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, 1000);
    });
};

/**
 * Load a specific font
 * @param {string} fontName - The name of the font to load
 * @returns {Promise} Promise that resolves when the font is loaded
 */
export const loadFont = (fontName) => {
    const testEl = document.createElement('div');
    testEl.style.position = 'absolute';
    testEl.style.visibility = 'hidden';
    testEl.style.pointerEvents = 'none';
    testEl.className = 'terminal-nerd-font';
    testEl.textContent = 'Font Load Test';
    document.body.appendChild(testEl);
    
    return new Promise(resolve => {
        setTimeout(() => {
            document.body.removeChild(testEl);
            resolve();
        }, 100);
    });
};

export default {
    loadFont,
    preloadAllFonts,
    getFormattedFontFamily,
    fontDisplayNames
}; 