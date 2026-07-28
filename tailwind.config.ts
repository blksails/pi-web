import type { Config } from "tailwindcss";
import { piWebPreset } from "./packages/ui/tailwind-preset";

/**
 * Tailwind v3 config for the pi-web app shell.
 *
 * `content` scans the app's own files AND the `@blksails/pi-web-ui` source, because the
 * UI components ship raw `.tsx` with Tailwind utility classes — those classes
 * must be discovered here so they end up in the generated stylesheet.
 *
 * Color/radius token mapping and `darkMode: "class"` now come from the shared
 * `@blksails/pi-web-ui` preset (`packages/ui/tailwind-preset.ts`), so downstream apps can
 * adopt the same tokens with one `presets:` entry. Colors map to the shadcn CSS
 * variables provided by `@blksails/pi-web-ui/styles.css`, so no colors are hardcoded.
 */
const config: Config = {
  presets: [piWebPreset as Config],
  content: [
    "./src/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./node_modules/@blksails/pi-web-ui/src/**/*.{ts,tsx}",
    "./packages/ui/src/**/*.{ts,tsx}",
    // canvas-kit 内置工具的选项条/编辑器贡献带 Tailwind 类(4.2 注册表驱动装配)。
    "./node_modules/@blksails/pi-web-canvas-kit/src/**/*.{ts,tsx}",
    "./packages/canvas-kit/src/**/*.{ts,tsx}",
    // primitives 下沉的 shadcn 薄封装带 Tailwind 类(canvas-ui-m15 1.1)。
    "./node_modules/@blksails/pi-web-primitives/src/**/*.{ts,tsx}",
    "./packages/primitives/src/**/*.{ts,tsx}",
    // canvas-ui 迁出的 canvas 领域组件带 Tailwind 类(canvas-ui-m15 2.1)。
    "./node_modules/@blksails/pi-web-canvas-ui/src/**/*.{ts,tsx}",
    "./packages/canvas-ui/src/**/*.{ts,tsx}",
  ],
  plugins: [],
};

export default config;
