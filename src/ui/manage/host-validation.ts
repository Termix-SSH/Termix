import type { HostEditorForm, HostProtocols } from "@/sidebar/HostEditorData";

/** Field keys mapped to an i18n key saying what is wrong. */
export type HostFormErrors = Partial<Record<"ip" | "sshPort", string>>;

function validPort(port: unknown): boolean {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** What has to be fixed before a host can be saved. */
export function validateHostForm(
  form: Pick<HostEditorForm, "ip" | "sshPort">,
  protocols: Pick<HostProtocols, "enableSsh">,
): HostFormErrors {
  const errors: HostFormErrors = {};
  if (!form.ip.trim()) errors.ip = "manage.errorAddressRequired";
  if (protocols.enableSsh && !validPort(form.sshPort))
    errors.sshPort = "manage.errorPortRange";
  return errors;
}
