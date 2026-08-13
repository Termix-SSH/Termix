function isCloseActiveTabInput(input) {
  return (
    input.type === "keyDown" &&
    input.control === true &&
    input.alt !== true &&
    input.shift !== true &&
    input.meta !== true &&
    input.key.toLowerCase() === "w"
  );
}

module.exports = { isCloseActiveTabInput };
