# vite-plugin-css-dts-checker

Vite plugin that finds **unused classes in CSS/SCSS modules**. It reads the class names from the generated `.d.ts` typings and checks which of them are actually referenced in the file that imports the stylesheet.

Successor of [css-dts-checker-webpack-plugin](https://github.com/Reloaded2/css-dts-checker-webpack-plugin).

```
[plugin:css-dts-checker] src/Button/index.tsx (1:1): Unused classes from src/Button/style.module.scss: primary, disabled
```

## Requirements

- Vite >= 4
- TypeScript >= 4.9 (peer dependency, only used as a parser)
- Typings for your style files, e.g. generated with [typed-scss-modules](https://github.com/skovy/typed-scss-modules) or [typed-css-modules](https://github.com/Quramy/typed-css-modules). Style files without a `.d.ts` are skipped.

## Installation

```sh
npm i -D vite-plugin-css-dts-checker
# or: yarn add -D vite-plugin-css-dts-checker
# or: pnpm add -D vite-plugin-css-dts-checker
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import cssDtsChecker from "vite-plugin-css-dts-checker";

export default defineConfig({
  plugins: [
    cssDtsChecker({
      severity: "warn",
      ignoreClasses: [/^is-/, "active"],
    }),
  ],
});
```

Use `severity: "error"` (e.g. in CI) to make the build fail on unused classes.

## Options

| Option          | Type                      | Default                          | Description |
| --------------- | ------------------------- | -------------------------------- | ----------- |
| `include`       | `FilterPattern`           | `/\.[cm]?[jt]sx?$/`              | Files that are checked. |
| `exclude`       | `FilterPattern`           | `/node_modules/`                 | Files that are skipped. |
| `extensions`    | `string[]`                | `["css","scss","sass","less"]`   | Style file extensions that are checked. |
| `ignoreClasses` | `(string \| RegExp)[]`    | `[]`                             | Classes that are never reported. |
| `severity`      | `"warn" \| "error"`       | `"warn"`                         | `"error"` fails the build. |
| `dts`           | `(styleFile) => string[]` | `x.scss.d.ts`, `x.d.scss.ts`     | Candidate paths of the `.d.ts` for a style file. |
| `apply`         | `"build" \| "serve"`      | both                             | Run only during build or only in the dev server. |

## What counts as "used"

For every import of a style file (`import s from`, `import * as s from`, `import { foo } from`) the importing file is scanned for:

- `s.foo` and `s["foo"]`
- `const { foo, bar } = s`
- `` s[`btn-${size}`] `` (marks all classes starting with `btn-`)
- `import { foo }` that is referenced somewhere

If `s` is passed on (`<Comp styles={s} />`, `classNames(s)`, `...s`) or accessed with a fully dynamic key (`s[key]`), the file is skipped, because the usage can't be determined statically.

## Limitations

- Usage is checked **per importing file**. A stylesheet shared by several files can report classes that another file uses. Use `ignoreClasses` for those.
- Variable shadowing is not tracked.
- Classes used only via `composes` or global selectors are not considered.

## How it works

The plugin runs in the `transform` hook (`enforce: "pre"`) and only looks at modules that are actually part of the module graph. Files without a style import are skipped by a cheap regex check before anything is parsed. Class names are read from the `.d.ts` with the TypeScript parser only (no `Program`, no type checker) and cached by modification time. Import paths are resolved with Vite's resolver, so aliases work. The `.d.ts` is registered with `addWatchFile`.

## License

MIT
