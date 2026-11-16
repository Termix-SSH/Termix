// Dies right after every start, so core has to give up on it.
export function activate() {
  setTimeout(() => process.exit(3), 20);
}
