# Termix Access Disclosure

Last updated: July 27, 2026

Termix accesses resources only when required by a configured feature or an action initiated by a user.

## Configured systems

Termix can connect to hosts and services you add, including SSH, Telnet, RDP, VNC, Docker, Proxmox, serial devices, tunnels, monitoring endpoints, and remote Termix servers.

## Credentials and sessions

Termix can use saved usernames, passwords, private keys, certificates, tokens, cookies, and session metadata to authenticate and maintain requested connections. Administrators should restrict instance access and review stored credentials, roles, API keys, active sessions, and shares.

## Files, clipboard, and local data

When requested, Termix can read or write remote files, transfer files, use clipboard data, import or export database backups, and store browser or desktop preferences. Operating systems and browsers may display additional permission prompts.

## Optional integrations

Termix contacts external services only when the related feature is enabled or configured. These can include SSO identity providers, ACME certificate authorities, Tailscale, webhooks, update services, analytics, and remote synchronization servers.

## Analytics

Optional analytics can be disabled in Admin Settings. Analytics events are intended to describe product usage and technical state. They should not intentionally include credentials, terminal input, or file contents.
