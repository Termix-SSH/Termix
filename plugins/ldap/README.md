# LDAP

Sign in with a username and password checked against an LDAP or Active Directory server.

## Features

- Sign in with a username and password checked against an LDAP or Active Directory server.
- Add more than one directory. Each gets its own option on the login screen.
- Make members of an admin group Termix admins.

## Settings

### Admin

- Directories: the LDAP servers, search bases and admin group for each directory.

## Permissions

- `ldap.manage`: Add, edit and remove LDAP directories. Only admins have it by default.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
