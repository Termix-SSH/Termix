import type { CredentialDensity } from "@/types/credential-sidebar-preferences";

const HEIGHTS = {
  comfortable: {
    base: 45,
    openKey: 104.75,
    openPassword: 78.5,
    actionsOnlyKey: 75.75,
    actionsOnlyPassword: 49.5,
    alwaysKey: 100.25,
    alwaysPassword: 74,
    tags: 18.5,
  },
  compact: {
    base: 23,
    openKey: 79.25,
    openPassword: 56.5,
    actionsOnlyKey: 50.25,
    actionsOnlyPassword: 27.5,
    alwaysKey: 74.75,
    alwaysPassword: 52,
    tags: 12.5,
  },
} as const;

export function getCredentialRowHeight({
  density,
  isKey,
  alwaysShowActions,
  actionsOnly,
  isOpen,
  showTags,
  tagCount,
}: {
  density: CredentialDensity;
  isKey: boolean;
  alwaysShowActions: boolean;
  actionsOnly: boolean;
  isOpen: boolean;
  showTags: boolean;
  tagCount: number;
}): number {
  const heights = HEIGHTS[density];
  let height: number = heights.base;

  if (alwaysShowActions) {
    height = isKey ? heights.alwaysKey : heights.alwaysPassword;
  } else if (isOpen) {
    height = isKey ? heights.openKey : heights.openPassword;
  } else if (actionsOnly) {
    height = isKey ? heights.actionsOnlyKey : heights.actionsOnlyPassword;
  }

  return height + (showTags && tagCount > 0 ? heights.tags : 0);
}
