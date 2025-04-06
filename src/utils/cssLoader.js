/**
 * Utility functions for loading CSS dynamically
 */

/**
 * Loads CSS from a string and adds it to the document
 * @param {string} css - The CSS string to load
 * @returns {HTMLStyleElement} The created style element
 */
export const loadCSSFromString = (css) => {
  // Create a style element
  const style = document.createElement('style');
  
  // Add the CSS to the style element
  style.textContent = css;
  
  // Add the style element to the document head
  document.head.appendChild(style);
  
  // Return the style element for potential later removal
  return style;
};

/**
 * Loads CSS from a URL and adds it to the document
 * @param {string} url - The URL of the CSS file to load
 * @returns {HTMLLinkElement} The created link element
 */
export const loadCSSFromURL = (url) => {
  // Create a link element
  const link = document.createElement('link');
  
  // Set the link attributes
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = url;
  
  // Add the link element to the document head
  document.head.appendChild(link);
  
  // Return the link element for potential later removal
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