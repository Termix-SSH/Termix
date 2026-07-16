export interface ProxmoxGuest {
  name: string;
  vmid: number;
  type: "qemu" | "lxc";
  node: string;
  status: string;
  ip: string | null;
  connectionType: "ssh" | "rdp";
  enableDocker: boolean;
}

export interface ProxmoxDiscoverResult {
  guests: ProxmoxGuest[];
  credentialId: number | null;
  defaultCredentialId: number | null;
}

export interface ProxmoxSyncResult {
  created: number;
  updated: number;
  markedMissing: number;
  skipped: number;
  errors: string[];
}
