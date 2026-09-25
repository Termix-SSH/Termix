# Termix Identity

Claim a public handle and publish your SSH public keys under it. Any server
can then pull them into `authorized_keys`:

```bash
curl -fsSL https://<termix>/plugin-api/termix-identity/u/<handle> >> ~/.ssh/authorized_keys
```

Add `/<ALGO>` (for example `/ED25519`) to serve only one key type. The
resolver needs no login and is never cached.

## Certificate authority

Each handle can have its own SSH certificate authority. Servers trust it with
`TrustedUserCAKeys`, using the public key from `/u/<handle>/ca`. Termix then
issues short-lived certificates for your Ed25519 keys. Rotating the CA
revokes every certificate it issued. The CA private key is stored encrypted
with the installation key.

Certificates are downloaded once and never stored, so hosts in Termix do not
use them to connect. This plugin adds no SSH auth type.

## Old URLs

The 2.8 resolver URLs (`/termix-id/u/<handle>`, `/termix-id/u/<handle>/<ALGO>`
and `/termix-id/u/<handle>/ca`) permanently redirect here, so servers that
fetch them from scripts keep working. `curl -L` follows the redirect.

## Permission

`termix-identity.use` lets a user claim a handle, publish keys and run a CA.
Admins and users have it by default.
