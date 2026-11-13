export type SettingData = {
  key: string;
  value: string;
};

const SECRET_SETTING_PREFIXES = [
  "reset_code_",
  "temp_reset_token_",
  "audit_log_forward_token",
];

// Server state an export or import must never carry: the audit chain's own
// records and the admin wait switch.
const PROTECTED_SETTING_PREFIXES = ["audit_chain_", "admin_hold_"];

/** Whether an imported settings row may be written. */
export function isImportableSetting(key: string): boolean {
  return ![...SECRET_SETTING_PREFIXES, ...PROTECTED_SETTING_PREFIXES].some(
    (prefix) => key.startsWith(prefix),
  );
}

/**
 * Global settings are instance config, not user data: only an admin's export
 * carries them (import only applies them for admins anyway), and never the
 * one-time reset codes or the audit forwarding token.
 */
export function selectExportableSettings(
  rows: SettingData[],
  isAdmin: boolean,
): SettingData[] {
  if (!isAdmin) return [];
  return rows.filter((row) => isImportableSetting(row.key));
}
