import { listHosts } from "./client";
import type { SSHHost } from "../host-types";

export async function getSSHHosts(): Promise<SSHHost[]> {
  return (await listHosts()) as unknown as SSHHost[];
}
