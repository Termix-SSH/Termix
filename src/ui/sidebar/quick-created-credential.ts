export interface CredentialOption {
  id: string;
  name: string;
  username: string;
}

export function toCredentialOption(
  credential: Record<string, unknown>,
): CredentialOption | null {
  if (
    (typeof credential.id !== "number" && typeof credential.id !== "string") ||
    typeof credential.name !== "string"
  ) {
    return null;
  }

  return {
    id: String(credential.id),
    name: credential.name,
    username:
      typeof credential.username === "string" ? credential.username : "",
  };
}
