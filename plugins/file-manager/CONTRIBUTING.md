# Contributing to File Manager

## Development

```bash
npm run build      # build into dist/
npm run test       # run this plugin's tests
npm run typecheck  # type-check this plugin
npm run validate   # check manifest.json
npm run format     # format the code with Prettier
```

## Settings

### User

- **Simultaneous File Transfers:** how many uploads and downloads run at once
- **Confirm before moving files to trash:** ask before a delete. Permanent deletes always ask

### Host

- **Enable File Manager:** show the file manager for this host
- **Default Path:** the folder to open first
- **SCP Legacy Mode:** use SCP for hosts without a working SFTP server

## Permissions

- `file-manager.use`: browse, edit and transfer files. Admins and users have it by default.
