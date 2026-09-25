import { listHosts } from "@termix/plugin-sdk/frontend";
import type { SSHHost } from "../host-types";

export async function getSSHHosts(): Promise<SSHHost[]> {
  return (await listHosts()) as unknown as SSHHost[];
}
