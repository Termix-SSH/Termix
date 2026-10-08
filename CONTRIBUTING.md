# Contributing

Termix is a small core plus plugins. This repo is the core: hosts, credentials, users, sharing, sessions, the app shell and the plugin runtime. Every other feature lives in its own `Plugin-<Name>` repo. If your change is about the terminal, file manager, Docker or any other plugin feature, open it in that plugin's repo instead.

## Prerequisites

- [Node.js](https://nodejs.org/en/download/) 22.12 or newer (built with v24)
- [NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- [Git](https://git-scm.com/downloads)

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/Termix-SSH/Termix
   ```
2. Install the dependencies:
   ```sh
   npm install
   ```

## Running the development server

```sh
npm run dev
```

This builds everything, starts the backend and then the Vite server at `http://localhost:5173/`. Backend changes restart the backend, and plugin changes in `../Termix-Plugins` rebuild and reload that plugin. `npm run dev:electron` does the same with the desktop app, and `npm run dev -- --help` lists the other options.

## Useful commands

```sh
npm run test         # run the test suite
npm run type-check   # type-check the core
npm run lint         # lint and the other repo checks
npm run format       # format the code with Prettier
```

## Making a change

1. **Fork the repository**: Click "Fork" at the top right of the [repository page](https://github.com/Termix-SSH/Termix).
2. **Create a branch**:
   ```sh
   git checkout -b feature/my-new-feature
   ```
3. **Make your changes** and add or update tests for them.
4. **Commit your changes**:
   ```sh
   git commit -m "feat: add my new feature"
   ```
5. **Push to your fork**:
   ```sh
   git push origin feature/my-new-feature
   ```
6. **Open a pull request** against the current `dev-*` branch with a clear description.

## Guidelines

- Follow the existing code style. The frontend uses React, Tailwind CSS and shadcn components in `src/ui/`.
- Never hardcode text. Use `t()` and add the English string to `src/ui/locales/en.json`. That's the only locale file you need to update. Other languages are translated automatically, and if an automatic translation is wrong you can fix it in that language's file.
- Keep the UI flat and square. Avoid rounded corners on panels, cards and dialogs.
- Use the theme variables (like `var(--bg-base)` and `var(--text-primary)`) instead of fixed colors.
- There is one component tree for desktop and mobile. Use `src/ui/hooks/use-mobile.ts` for layout changes.
- Core never names a plugin. If core needs something from a plugin, add a slot, action or component id that the plugin fills.
- Tests live in `src/backend/tests/` and `src/ui/tests/`, mirroring the source tree. `npm run test` must pass.
- Every API route gets an OpenAPI JSDoc comment like the routes around it.
- Use short commit messages that start with `feat:`, `fix:` or `chore:`, and link related issues.

## Building a plugin

Start from the [plugin template](https://github.com/Termix-SSH/Termix-Plugin-Template). It talks to Termix only through `@termix-ssh/plugin-sdk` and has its own build, test and release setup.

## Support

Bugs and ideas for Termix itself go in [this repo](https://github.com/Termix-SSH/Termix/issues/new/choose). Plugin problems go in that plugin's own `Plugin-<Name>` repo. Please be as detailed as possible, preferably in English. You can also ask in the [Discord](https://discord.gg/jVQGdvHDrf) server.
