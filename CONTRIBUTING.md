_# Contributing

## Prerequisites

- [Node.js](https://nodejs.org/en/download/) (built with v24)
- [NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- [Git](https://git-scm.com/downloads)

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/LukeGus/Termix
    ```
2. Install the dependencies:
    ```sh
    npm install
    ```

## Running the development server

Run the following commands:

```sh
npm run dev
npm run dev:backend
```

a
This will start the backend and the frontend Vite server. You can access Termix by going to `http://localhost:5174/`.

## Contributing

1. **Fork the repository**: Click the "Fork" button at the top right of
   the [repository page](https://github.com/LukeGus/Termix).
2. **Create a new branch**:
    ```sh
    git checkout -b feature/my-new-feature
    ```
3. **Make your changes**: Implement your feature, fix, or improvement.
4. **Commit your changes**:
    ```sh
    git commit -m "Feature request my new feature"
    ```
5. **Push to your fork**:
    ```sh
    git push origin feature/my-feature-request
    ```
6. **Open a pull request**: Go to the original repository and create a PR with a clear description.

## 📝 Guidelines

- Follow the existing code style. Use Tailwind CSS with shadcn components.
- Use the below color scheme with the respective CSS variable placed in the `className` of a div/component.
- Place all API routes in the `main-axios.ts` file. Updating the `openapi.json` is unneeded.
- Include meaningful commit messages.
- Link related issues when applicable.
- `MobileApp.tsx` renders when the users screen width is less than 768px, otherwise it loads the usual `DesktopApp.tsx`.

## Color Scheme

### Background Colors

| CSS Variable                  | Color Value | Usage                       | Description                              |
|-------------------------------|-------------|-----------------------------|------------------------------------------|
| `--color-dark-bg`             | `#18181b`   | Main dark background        | Primary dark background color            |
| `--color-dark-bg-darker`      | `#0e0e10`   | Darker backgrounds          | Darker variant for panels and containers |
| `--color-dark-bg-darkest`     | `#09090b`   | Darkest backgrounds         | Darkest background (terminal)            |
| `--color-dark-bg-light`       | `#141416`   | Light dark backgrounds      | Lighter variant of dark background       |
| `--color-dark-bg-very-light`  | `#101014`   | Very light dark backgrounds | Very light variant of dark background    |
| `--color-dark-bg-panel`       | `#1b1b1e`   | Panel backgrounds           | Background for panels and cards          |
| `--color-dark-bg-panel-hover` | `#232327`   | Panel hover states          | Background for panels on hover           |

### Element-Specific Backgrounds

| CSS Variable             | Color Value | Usage              | Description                                   |
|--------------------------|-------------|--------------------|-----------------------------------------------|
| `--color-dark-bg-input`  | `#222225`   | Input fields       | Background for input fields and form elements |
| `--color-dark-bg-button` | `#23232a`   | Button backgrounds | Background for buttons and clickable elements |
| `--color-dark-bg-active` | `#1d1d1f`   | Active states      | Background for active/selected elements       |
| `--color-dark-bg-header` | `#131316`   | Header backgrounds | Background for headers and navigation bars    |

### Border Colors

| CSS Variable                 | Color Value | Usage           | Description                              |
|------------------------------|-------------|-----------------|------------------------------------------|
| `--color-dark-border`        | `#303032`   | Default borders | Standard border color                    |
| `--color-dark-border-active` | `#2d2d30`   | Active borders  | Border color for active elements         |
| `--color-dark-border-hover`  | `#434345`   | Hover borders   | Border color on hover states             |
| `--color-dark-border-light`  | `#5a5a5d`   | Light borders   | Lighter border color for subtle elements |
| `--color-dark-border-medium` | `#373739`   | Medium borders  | Medium weight border color               |
| `--color-dark-border-panel`  | `#222224`   | Panel borders   | Border color for panels and cards        |

### Interactive States

| CSS Variable             | Color Value | Usage             | Description                                   |
|--------------------------|-------------|-------------------|-----------------------------------------------|
| `--color-dark-hover`     | `#2d2d30`   | Hover states      | Background color for hover effects            |
| `--color-dark-active`    | `#2a2a2c`   | Active states     | Background color for active elements          |
| `--color-dark-pressed`   | `#1a1a1c`   | Pressed states    | Background color for pressed/clicked elements |
| `--color-dark-hover-alt` | `#2a2a2d`   | Alternative hover | Alternative hover state color                 |

## Support

If you need help with Termix, you can join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support
channel. You can also open an issue or open a pull request on the [GitHub](https://github.com/LukeGus/Termix/issues)
repo.