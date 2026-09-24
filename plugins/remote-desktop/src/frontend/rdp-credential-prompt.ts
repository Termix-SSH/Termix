import type { RemoteHostLogin } from "./host-remote";

export function needsRdpCredentialPrompt({
  protocol,
  rdpAuthType,
  authOverrides,
}: {
  protocol: "rdp" | "vnc" | "telnet";
  rdpAuthType?: string;
  authOverrides?: RemoteHostLogin["authOverrides"];
}): boolean {
  return (
    protocol === "rdp" &&
    rdpAuthType === "none" &&
    !authOverrides?.rdp?.credentialId
  );
}
