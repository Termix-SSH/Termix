import type { Credential } from "@/types/ui-types";

/**
 * Credential folders are explicitly flat (no nesting), unlike HostFolder --
 * so this has no depth/path-string tree logic, just a name and a list of
 * credentials. `children` matches HostFolder's shape for isFolder()
 * structural parity, but never contains another CredentialFolder.
 */
export interface CredentialFolder {
  name: string;
  children: Credential[];
}

export function isFolder(
  item: Credential | CredentialFolder,
): item is CredentialFolder {
  return "children" in item;
}

export function credentialMatchesQuery(cred: Credential, query: string) {
  return (
    cred.name.toLowerCase().includes(query) ||
    cred.username.toLowerCase().includes(query) ||
    cred.tags?.some((t) => t.toLowerCase().includes(query))
  );
}

export type VirtualRow = {
  item: Credential | CredentialFolder;
  depth: number;
};

/**
 * Builds the flattened, currently-visible row list for the virtualizer.
 * Folders are always depth 0, credentials always depth 1 -- there is no
 * deeper nesting to walk, unlike hosts' recursive collectVisibleRows.
 */
export function collectVisibleRows(
  folders: CredentialFolder[],
  query: string,
  openSet: Set<string>,
): VirtualRow[] {
  const out: VirtualRow[] = [];
  const q = query.trim().toLowerCase();

  for (const folder of folders) {
    const matchingCreds = q
      ? folder.children.filter((c) => credentialMatchesQuery(c, q))
      : folder.children;
    if (matchingCreds.length === 0) continue;

    out.push({ item: folder, depth: 0 });
    const isOpen = q ? true : openSet.has(folder.name);
    if (isOpen) {
      for (const cred of matchingCreds) {
        out.push({ item: cred, depth: 1 });
      }
    }
  }

  return out;
}

export function collectAllFolderNames(folders: CredentialFolder[]): string[] {
  return folders.map((f) => f.name);
}
