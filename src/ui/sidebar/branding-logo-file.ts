export const BRANDING_LOGO_MAX_BYTES = 750 * 1024;
export const BRANDING_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
export const BRANDING_LOGO_ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function isAcceptedBrandingLogoFile(file: {
  type: string;
  size: number;
}): boolean {
  return (
    BRANDING_LOGO_ACCEPTED_TYPES.has(file.type) &&
    file.size > 0 &&
    file.size <= BRANDING_LOGO_MAX_BYTES
  );
}
