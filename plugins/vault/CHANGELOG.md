# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Vault SSH signing moved out of core. The callback is now
  `/plugin-api/vault/oidc/callback`; the 2.8 URI `/vault/oidc/callback`
  still works and upgraded installs keep sending it until an admin turns
  off "Use the old redirect URI".
- Profiles keep their ids and sync ids. A host's profile is now a host
  setting of this plugin.
- Signed certificates are stored encrypted with the installation key.
  Certificates cached by 2.8 are not carried over; the next connection asks
  for one sign-in.
- Sharing a profile needs the "Share Vault profiles" permission, which
  admins have by default.
