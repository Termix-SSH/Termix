# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- Termix ID moved out of core. The resolver is now
  `/plugin-api/termix-identity/u/<handle>`; the 2.8 URLs under
  `/termix-id/u/` redirect to it.
- Handles, published keys and certificate authorities are kept on upgrade.
  The CA private key is now encrypted with the installation key instead of
  the owner's data key, so issuing a certificate no longer needs the data
  key unlocked.
- New `termix-identity.use` permission, granted to admins and users.
