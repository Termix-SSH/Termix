import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HostCredentialList } from "@/sidebar/HostCredentialList";
import type { Credential, Host } from "@/types/ui-types";

vi.mock("@/main-axios", () => ({
  getCredentialDetails: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "1",
    name: "Deploy Key",
    username: "ubuntu",
    type: "key",
    folder: "Shared",
    tags: [],
    ...overrides,
  };
}

function makeHost(overrides: Partial<Host>): Host {
  return {
    id: "host-1",
    name: "prod-api",
    username: "ubuntu",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: false,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "credential",
    enableTerminal: true,
    enableCommandHistory: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: true,
    enableDocker: false,
    enableProxmox: false,
    enableTmuxMonitor: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  };
}

async function renderOpenedList({
  credentials = [makeCredential()],
  hosts = [],
}: {
  credentials?: Credential[];
  hosts?: Host[];
} = {}) {
  render(
    <HostCredentialList
      credentialFolders={["Shared"]}
      filteredCredentials={credentials}
      credentialsLoading={false}
      allHosts={hosts}
      editingFolderName={null}
      editingFolderValue=""
      termixIdLinkedIds={new Set()}
      onEditingFolderNameChange={vi.fn()}
      onEditingFolderValueChange={vi.fn()}
      onRenameFolder={vi.fn()}
      onDeployCredential={vi.fn()}
      onEditCredential={vi.fn()}
      onDeleteCredential={vi.fn()}
      onAddCredential={vi.fn()}
      onConfirmDialogChange={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByText("Shared"));
}

describe("HostCredentialList credential usage", () => {
  it("shows the SSH host using a credential", async () => {
    await renderOpenedList({
      hosts: [makeHost({ id: "host-1", name: "prod-api", credentialId: "1" })],
    });

    expect(screen.getByText("prod-api")).toBeTruthy();
  });

  it("shows two host names and a compact remaining count", async () => {
    await renderOpenedList({
      hosts: [
        makeHost({ id: "host-1", name: "prod-api", credentialId: "1" }),
        makeHost({ id: "host-2", name: "jump-box", credentialId: "1" }),
        makeHost({ id: "host-3", name: "worker-01", credentialId: "1" }),
      ],
    });

    expect(screen.getByText("prod-api")).toBeTruthy();
    expect(screen.getByText("jump-box")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.queryByText("worker-01")).toBeNull();
  });

  it("does not show host chips when no SSH host uses the credential", async () => {
    await renderOpenedList();

    expect(screen.queryByLabelText(/^Used by /)).toBeNull();
  });

  it("does not count non-SSH protocol credential ids", async () => {
    await renderOpenedList({
      hosts: [
        makeHost({
          id: "host-1",
          name: "rdp-only",
          authType: "password",
          credentialId: undefined,
          rdpCredentialId: "1",
          enableSsh: false,
          enableRdp: true,
        }),
      ],
    });

    expect(screen.queryByText("rdp-only")).toBeNull();
    expect(screen.queryByLabelText(/^Used by /)).toBeNull();
  });
});
