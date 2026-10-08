export type SettingData = {
  key: string;
  value: string;
};

const SECRET_SETTING_PREFIXES = [
  "reset_code_",
  "temp_reset_token_",
  "audit_log_forward_token",
];

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
  return rows.filter(
    (row) =>
      !SECRET_SETTING_PREFIXES.some((prefix) => row.key.startsWith(prefix)),
  );
}
