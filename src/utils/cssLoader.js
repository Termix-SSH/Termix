/**
 * Utility functions for loading CSS dynamically
 */

/**
 * Loads CSS from a string and adds it to the document
 * @param {string} css - The CSS string to load
 * @returns {HTMLStyleElement} The created style element
 */
export const loadCSSFromString = (css) => {
  const style = document.createElement('style');

  style.textContent = css;

  document.head.appendChild(style);

  return style;
};

/**
 * Loads CSS from a URL and adds it to the document
 * @param {string} url - The URL of the CSS file to load
 * @returns {HTMLLinkElement} The created link element
 */
export const loadCSSFromURL = (url) => {
  const link = document.createElement('link');

  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = url;

  document.head.appendChild(link);

  return link;
};

/**
 * Removes a style or link element created by loadCSSFromString or loadCSSFromURL
 * @param {HTMLElement} element - The element to remove
 */
export const removeCSS = (element) => {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
};

export default {
  loadCSSFromString,
  loadCSSFromURL,
  removeCSS
}; 