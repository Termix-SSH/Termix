/**
 * Auth types whose SSH certificate is issued on demand through a browser
 * sign-in and cached per user and host (opkssh_tokens). They share the
 * whole connect path; only the issuing flow differs.
 */
export const ISSUED_CERTIFICATE_AUTH_TYPES = ["opkssh", "stepca"] as const;

export function usesIssuedCertificate(authType: string | null | undefined) {
  return (ISSUED_CERTIFICATE_AUTH_TYPES as readonly string[]).includes(
    authType ?? "",
  );
}
