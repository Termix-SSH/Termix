# ACME Certificates

Gets and renews the Termix HTTPS certificate from Let's Encrypt or another ACME provider.

## Features

- Gets a certificate from Let's Encrypt, Let's Encrypt staging or any ACME directory URL.
- Checks twice a day and renews when there is no certificate, the current one is self-signed, it does not cover the domain or it expires within 30 days.
- Swaps in the new certificate without a restart.
- Shows the current certificate and the last attempt, with a button to request one now.

## Setup

Pick a challenge type:

- HTTP: the provider fetches `http://<domain>/.well-known/acme-challenge/...`, so port 80 must reach Termix.
- DNS (Cloudflare): needs a Cloudflare API token with Zone:DNS:Edit. Works when port 80 is closed.

If you turn this plugin off, Termix keeps serving the current certificate but nothing renews it. Admin Settings > HTTPS certificate warns you before it expires. Uploading your own certificate is still done there.

## Settings

### Admin

- Renew automatically: turn automatic renewal on or off.
- Domain and Email: the domain to cover and the contact email for the provider.
- Certificate authority: Let's Encrypt, Let's Encrypt staging or a custom ACME directory URL.
- Challenge type: HTTP or DNS (Cloudflare).
- Cloudflare API token: used by the DNS challenge. Stored encrypted.

## Permissions

- `acme-ssl.manage`: Manage ACME certificates. Only admins have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```

See `packages/plugin-sdk/ARCHITECTURE.md` for the plugin contract.
