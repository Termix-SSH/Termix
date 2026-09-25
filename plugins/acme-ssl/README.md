# ACME Certificates

Gets the certificate Termix serves over HTTPS from Let's Encrypt, or any other
ACME certificate authority, and renews it before it expires.

Termix itself serves HTTPS. This plugin only gets certificates: it hands each
one to core, which checks that the key matches and swaps it in without a
restart. Turn the plugin off and the current certificate keeps being served,
but nothing renews it. Admin Settings > HTTPS certificate then warns with the
expiry date.

## Settings

Admin settings, under Settings > Plugins > ACME Certificates:

- **Renew automatically**: check twice a day and get a new certificate when
  there is none, it is the self-signed one, it does not cover the domain, or
  it expires within 30 days.
- **Domain** and **Email**.
- **Certificate authority**: Let's Encrypt, Let's Encrypt staging (for
  testing without rate limits) or a custom ACME directory URL.
- **Challenge type**:
  - **HTTP**: the CA fetches `http://<domain>/.well-known/acme-challenge/...`,
    so port 80 must reach Termix. Core answers it.
  - **DNS (Cloudflare)**: needs an API token with Zone:DNS:Edit. Works when
    port 80 is closed.

The status box shows the served certificate and the last attempt, and has a
button to request a certificate now.

## How it works

It runs [acme-client](https://github.com/publishlab/node-acme-client) with
every request sent through `ctx.fetch`. The ACME account key is sealed with
`ctx.secrets.seal` and kept in `ctx.kv`. Certificates are written and loaded
through `ctx.system` (`system:tls`).
