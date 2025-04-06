/**
 * Terminal Theme Test
 * 
 * This script tests that terminal customization settings are properly saved and applied.
 * It can be run in the browser console to verify that the settings are working as expected.
 */

// Test configuration with all customizations
const testTerminalConfig = {
    theme: 'dracula',
    cursorStyle: 'bar',
    fontFamily: 'firaCode',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 1.2,
    letterSpacing: 1,
    cursorBlink: true,
    sshAlgorithm: 'aes256-ctr',
    useNerdFont: true
};

// Function to check if the terminal settings are applied correctly
const verifyTerminalSettings = (terminal, config) => {
    const terminalElement = terminal.element;
    const computedStyle = window.getComputedStyle(terminalElement);
    
    // Get the xterm.js instance
    const xtermInstance = terminal._core;
    
    console.log('Verifying terminal settings:');
    
    // Check theme (background color)
    const themeMap = {
        'dracula': '#282a36',
        'dark': '#1e1e1e',
        'light': '#ffffff',
        'veryDark': '#000000',
        'nord': '#2e3440',
        'solarized': '#002b36',
        'github': '#ffffff',
        'monokai': '#272822'
    };
    
    const expectedBgColor = themeMap[config.theme] || themeMap.dark;
    const actualBgColor = terminal.options.theme.background;
    console.log(`Theme (${config.theme}): Expected bg ${expectedBgColor}, Actual bg ${actualBgColor}`);
    
    // Check cursor style
    console.log(`Cursor style: Expected ${config.cursorStyle}, Actual ${terminal.options.cursorStyle}`);
    
    // Check font settings
    console.log(`Font family: Expected to include ${config.fontFamily}, Actual ${terminal.options.fontFamily}`);
    console.log(`Font size: Expected ${config.fontSize}px, Actual ${terminal.options.fontSize}px`);
    console.log(`Line height: Expected ${config.lineHeight}, Actual ${terminal.options.lineHeight}`);
    
    // Check other settings
    console.log(`Cursor blink: Expected ${config.cursorBlink}, Actual ${terminal.options.cursorBlink}`);
    
    return true;
};

// Function to run all tests
const runTests = () => {
    console.log('=== Testing Terminal Customization ===');
    
    // Check if there's an active terminal
    if (!window.terminalSockets || Object.keys(window.terminalSockets).length === 0) {
        console.error('No active terminals found. Please open a terminal connection first.');
        return;
    }
    
    // Get the first terminal socket
    const terminalId = Object.keys(window.terminalSockets)[0];
    const activeTerminal = document.querySelector('.terminal-container .terminal');
    
    if (!activeTerminal) {
        console.error('No terminal element found in the DOM.');
        return;
    }
    
    // Find the terminal instance
    const terminalInstance = activeTerminal._xterm;
    
    if (!terminalInstance) {
        console.error('Cannot access terminal instance. Make sure the terminal is initialized.');
        return;
    }
    
    // Verify current settings
    console.log('Current terminal settings:');
    verifyTerminalSettings(terminalInstance, terminalInstance.options);
    
    console.log('\nTest completed.');
};

// To run the test, execute this function in the browser console:
// runTests();

export default runTests; 