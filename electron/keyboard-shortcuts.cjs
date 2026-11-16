/**
 * Ctrl+W closes the active tab instead of the window. macOS closes tabs with
 * Cmd+W through its menu and leaves Ctrl+W to the page.
 */
function isCloseActiveTabInput(input, platform = process.platform) {
  return (
    platform !== "darwin" &&
    input.type === "keyDown" &&
    input.control === true &&
    input.alt !== true &&
    input.shift !== true &&
    input.meta !== true &&
    input.key.toLowerCase() === "w"
  );
}

module.exports = { isCloseActiveTabInput };
