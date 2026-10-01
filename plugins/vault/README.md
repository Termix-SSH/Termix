# HashiCorp Vault

Connect to hosts with short-lived SSH certificates from HashiCorp Vault, after signing in to Vault with OIDC.

## Features

- Adds the Vault login type to the host editor.
- Signs you in to Vault with OIDC in the browser.
- Has Vault's SSH secrets engine sign a fresh key and keeps the certificate until it expires.
- Never stores a Vault token, AppRole secret or long-lived key.

## Setup

A profile holds the Vault address and namespace, the OIDC mount and role, the SSH secrets mount and signer role, the valid principals and the key type. Pick Vault as the login type in the host editor, then choose or create a profile there. Profiles sync between the desktop app and a server.

## Settings

### Admin

- Redirect URI: add `<base URL>/plugin-api/vault/oidc/callback` to `allowed_redirect_uris` in each Vault OIDC role.
- Use the old redirect URI: keep sending the 2.8 URI `<base URL>/vault/oidc/callback`. Upgraded installs keep this on until you turn it off.

### Host

- Vault signer profile: the profile this host uses.

## Permissions

- `vault.use`: Sign in to hosts with Vault. Admins and users have it by default.
- `vault.share`: Share Vault profiles with everyone. Only admins have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
