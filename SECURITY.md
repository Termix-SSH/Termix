# Security Policy

## Reporting a Vulnerability

Please report any vulnerabilities to [GitHub Security](https://github.com/Termix-SSH/Termix/security/advisories).

## External secret storage

By default, a single-container installation generates its keys in the Termix
data directory for ease of recovery. Production deployments that keep backups
or database files outside a trusted encrypted volume should set
`TERMIX_REQUIRE_EXTERNAL_SECRETS=true` and provide all four keys through a
secret manager:

- `JWT_SECRET` (at least 64 characters)
- `DATABASE_KEY` (64 hexadecimal characters)
- `ENCRYPTION_KEY` (64 hexadecimal characters)
- `INTERNAL_AUTH_TOKEN` (at least 32 characters)

Each value can instead be mounted as a Docker or Kubernetes secret and supplied
with its corresponding `_FILE` variable, such as `ENCRYPTION_KEY_FILE`.
Hardened mode fails closed instead of writing a replacement key beside the
encrypted database.
