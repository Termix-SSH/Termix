# Termix Identity

Publish your SSH public keys under a public handle and run your own SSH certificate authority.

## Features

- Claim a public handle and publish your SSH public keys under it.
- Run your own SSH certificate authority for each handle.
- Issue short-lived certificates for your Ed25519 keys.

## Setup

Any server can pull your keys into `authorized_keys`:

```bash
curl -fsSL https://<termix>/plugin-api/termix-identity/u/<handle> >> ~/.ssh/authorized_keys
```

Add `/<ALGO>`, for example `/ED25519`, to get only one key type. This URL needs no login and is never cached.

To use the certificate authority, point `TrustedUserCAKeys` on your servers at the public key from `/u/<handle>/ca`. Rotating the CA revokes every certificate it issued. Certificates are downloaded once and not stored, so Termix hosts do not use them to connect.

The 2.8 URLs under `/termix-id/u/` redirect here, so existing scripts keep working. Use `curl -L` to follow the redirect.

## Permissions

- `termix-identity.use`: Claim a handle, publish keys and run a CA. Admins and users have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
