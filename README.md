## Why

Vite doesn't support polyfill detection by default. You can use `@vitejs/plugin-legacy` with `modernPolyfills` but it is Babel-based and can be slow.

Rolldown (or rather oxc) currently doesn't support polyfill detection at all [source](https://github.com/oxc-project/oxc/blob/d35b25f93b351ca6d5853e3982af33eb7ed04157/crates/oxc_transformer/src/options/babel/env/mod.rs#L45-L51). This plugin uses `swc` to detect and include polyfills based on the usage and target browsers.

Plugin assumes modern browsers so it doesn't include `regenerator-runtime`. If you need to support legacy browsers you should use `@vitejs/plugin-legacy` instead.

## Usage

```ts
import { defineConfig } from "vite";
import polyfillDetection from "@nulladdict/vite-plugin-polyfill-detection";

export default defineConfig({
  plugins: [
    polyfillDetection({
      targets: ["chrome >= 111", "edge >= 111", "firefox >= 114", "safari >= 16.4"],
    }),
  ],
});
```

## Options

### `targets`

- **Type**: `string | Array<string> | Record<string, string>`
- **Required**

Specifies which browsers to polyfill for. Passed as [`targets`](https://swc.rs/docs/configuration/supported-browsers#targets) to `@swc/core` to determine which polyfills are needed based on actual usage in your code. The query is browserslist-compatible with some limitations.
