const namePatterns = ['delete', 'remove', 'destroy', 'drop', 'purge', 'reset'];
const argsPatterns = ['"delete"', '"put"', '"patch"'];

export function isDangerous(toolName: string, argsJSON: string): boolean {
  const lower = toolName.toLowerCase();
  for (const p of namePatterns) {
    if (lower.includes(p)) return true;
  }
  const lowerArgs = argsJSON.toLowerCase();
  for (const m of argsPatterns) {
    if (lowerArgs.includes(m)) return true;
  }
  return false;
}
