# Contributing to ACME Certificates

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### Admin

- **Renew automatically:** checks twice a day and renews when there is no certificate, it is self-signed, it does not cover the domain, or it expires within 30 days
- **Domain:** the public domain name the certificate covers
- **Email:** the contact email for the ACME account
- **Certificate authority:** Let's Encrypt, Let's Encrypt staging, or a custom ACME directory
- **ACME directory URL:** only for a custom authority, and must be https
- **Challenge type:** HTTP or DNS (Cloudflare)
- **Cloudflare API token:** used by the DNS challenge, stored encrypted

## Permissions

- `acme-ssl.manage`: see the certificate status and request a new certificate. Only admins have it by default.
