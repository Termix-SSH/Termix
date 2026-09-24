export interface LdapConfig {
  host: string;
  port: number;
  useTLS: boolean;
  bindDN: string;
  bindPassword: string;
  userSearchBase: string;
  userSearchFilter: string;
  usernameAttribute: string;
  displayNameAttribute: string;
  groupSearchBase?: string;
  adminGroup?: string;
  allowedUsers?: string;
}

export interface ProviderRow {
  id: number;
  name: string;
  enabled: boolean;
  displayOrder: number;
  config: string;
  createdAt: string;
  updatedAt: string;
}

export const REQUIRED_FIELDS = [
  "host",
  "port",
  "bindDN",
  "bindPassword",
  "userSearchBase",
  "userSearchFilter",
  "usernameAttribute",
] as const;
