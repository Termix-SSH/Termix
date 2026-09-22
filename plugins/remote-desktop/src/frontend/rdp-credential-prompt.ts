import type { HostAuthOverrides } from "@/types/auth-protocols";

export function needsRdpCredentialPrompt({
  protocol,
  rdpAuthType,
  authOverrides,
}: {
  protocol: "rdp" | "vnc" | "telnet";
  rdpAuthType?: string;
  authOverrides?: HostAuthOverrides;
}): boolean {
  return (
    protocol === "rdp" &&
    rdpAuthType === "none" &&
    !authOverrides?.rdp?.credentialId
  );
}
