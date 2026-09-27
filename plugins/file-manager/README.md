# File Manager

Browse, edit and transfer files over SFTP, including between two hosts.

## Features

- Browse, upload, download, rename, move and delete files over SFTP.
- Edit files in a built-in code editor.
- Transfer files between two hosts in the SFTP tab.
- Restore deleted files from the trash until they are cleaned up.
- Save bookmarks to folders you use often.
- Browse local files in the desktop app.

## Settings

### Host

- Enable File Manager: show the file manager for this host.
- Default Path: the folder to open first.
- SCP Legacy Mode: use SCP for hosts without a working SFTP server.

## Permissions

- `file-manager.use`: Browse, edit and transfer files. Admins and users have it by default.

## Services

Provides to other plugins:

- `files.sftp`: read and write files on a host.

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
```
