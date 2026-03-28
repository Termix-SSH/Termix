export const COMMON_TERMINAL_COMMANDS = [
  "ls",
  "ls -la",
  "cd ..",
  "pwd",
  "cat",
  "less",
  "tail -f",
  "grep -R",
  "find . -name",
  "mkdir -p",
  "rm",
  "cp -r",
  "mv",
  "touch",
  "chmod +x",
  "chown -R",
  "sudo",
  "sudo systemctl status",
  "sudo systemctl restart",
  "journalctl -u",
  "ps aux",
  "top",
  "htop",
  "df -h",
  "du -sh",
  "free -h",
  "uname -a",
  "ip a",
  "ss -tulpn",
  "curl -I",
  "wget",
  "tar -xzf",
  "docker ps",
  "docker logs",
  "docker exec -it",
  "docker compose up -d",
  "docker compose logs -f",
  "git status",
  "git pull",
  "git log --oneline --graph --decorate",
  "npm install",
  "npm run dev",
  "npm run build",
] as const;

const MAX_AUTOCOMPLETE_SUGGESTIONS = 6;

function normalizeAutocompleteCommand(command: string) {
  return command.trim().toLowerCase();
}

export function isCommandAutocompleteEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.localStorage.getItem("commandAutocomplete") !== "false";
}

export function buildAutocompleteMatches(
  currentCommand: string,
  history: string[],
): string[] {
  const trimmedCommand = currentCommand.trim();
  if (!trimmedCommand) {
    return [];
  }

  const normalizedCurrentCommand =
    normalizeAutocompleteCommand(trimmedCommand);
  const matches: string[] = [];
  const seen = new Set<string>();

  const appendMatch = (candidate: string) => {
    const trimmedCandidate = candidate.trim();
    if (!trimmedCandidate) {
      return;
    }

    const normalizedCandidate =
      normalizeAutocompleteCommand(trimmedCandidate);

    if (
      normalizedCandidate === normalizedCurrentCommand ||
      !normalizedCandidate.startsWith(normalizedCurrentCommand) ||
      seen.has(normalizedCandidate)
    ) {
      return;
    }

    seen.add(normalizedCandidate);
    matches.push(trimmedCandidate);
  };

  history.forEach(appendMatch);
  COMMON_TERMINAL_COMMANDS.forEach(appendMatch);

  return matches.slice(0, MAX_AUTOCOMPLETE_SUGGESTIONS);
}
