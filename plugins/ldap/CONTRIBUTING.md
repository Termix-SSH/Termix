# Contributing to LDAP

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

- **Directories:** the LDAP servers people can sign in with. Each has a display name, host and port, TLS, bind DN and password, user and group search settings, an admin group and an allowed users list. The bind password is stored encrypted

## Permissions

- `ldap.manage`: add, edit and remove LDAP directories. Only admins have it by default.
