# Changelog

## 1.0.0

Bundled with Termix 2.9.0.

- ACME certificates moved out of core. Termix no longer runs certbot; the
  plugin talks to the CA directly.
- The domain, email, challenge type and Cloudflare token moved from Admin
  Settings into this plugin's settings. The token is now stored encrypted.
- Renewal is automatic: a check every 12 hours renews within 30 days of
  expiry.
- The 2.8 certbot account is not reused. A new ACME account is registered on
  the first request.
- Uploading your own certificate stays in Admin Settings > HTTPS certificate.
