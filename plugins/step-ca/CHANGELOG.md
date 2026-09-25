# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Step CA sign-in moved out of core. The callback is now
  `/plugin-api/step-ca/callback`; the 2.8 URI `/host/step-ca-callback`
  still works and upgraded installs keep sending it until an admin turns
  off "Use the old redirect URI".
- The CA URL, fingerprint, provisioner and private endpoint list moved from
  Admin Settings into this plugin's settings.
- Issued certificates are stored encrypted in the plugin's own table, so
  they survive a restart. Certificates cached by 2.8 are not carried over;
  the next connection asks for one sign-in.
- The terminal shows the sign-in dialog for Step CA hosts again.
