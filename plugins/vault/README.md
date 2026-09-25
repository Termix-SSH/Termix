# HashiCorp Vault

Adds the `vault` SSH auth type: Termix signs you in to Vault with OIDC in the
browser, has Vault's SSH secrets engine sign a fresh key, and keeps the
short-lived certificate until it expires.

Termix talks to Vault's HTTP API directly (`auth/<mount>/oidc/auth_url`,
`auth/<mount>/oidc/callback`, `<ssh mount>/sign/<role>`). No Vault token,
AppRole secret or long-lived key is ever stored.

## Profiles

A profile holds the connection settings only: the Vault address and
namespace, the OIDC mount and role, the SSH secrets mount and signer role,
the valid principals and the key type. Pick one in the host editor after
choosing "Vault" as the authentication type, and manage profiles from the
same place. Users with the "Share Vault profiles" permission can share a
profile with everyone.

## Settings

Admin settings, under Settings > Plugins > HashiCorp Vault:

- **Redirect URI**: add it to `allowed_redirect_uris` in each Vault OIDC
  role: `<base URL>/plugin-api/vault/oidc/callback`, or
  `<base URL>/vault/oidc/callback` while "Use the old redirect URI" is on.

An install upgraded from 2.8 that used Vault keeps the old redirect URI
turned on.
