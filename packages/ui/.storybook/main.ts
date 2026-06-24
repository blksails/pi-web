import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * Storybook(react-vite)配置 — `@blksails/pi-web-ui` 可视化文档(ui-components 10.1)。
 *
 * UI 组件以原始 `.tsx` 携带 Tailwind 工具类发布,样式在宿主(app)的 Tailwind 管线生成。
 * 这里为 Storybook 单独接入 Tailwind/PostCSS(经 `viteFinal` 注入,作用域仅限本 SB 构建,
 * 不写 postcss.config.* 以免泄漏到 vitest),配合 `preview` 的 styles.css(shadcn CSS 变量)
 * 使组件在 SB 内按主题渲染。
 */
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  async viteFinal(viteConfig) {
    // 源码以 NodeNext 风格用 `.js` 扩展名导入(实为 `.ts`/`.tsx`)。Vite 6 无 extensionAlias,
    // 故用 resolveId 钩子把无法命中的相对 `.js` 导入回退解析到同名 `.ts`/`.tsx`。
    viteConfig.plugins = [
      {
        name: "pi-ui-js-to-ts-resolver",
        enforce: "pre" as const,
        async resolveId(source: string, importer: string | undefined, options) {
          if (
            importer === undefined ||
            !source.endsWith(".js") ||
            !(source.startsWith("./") || source.startsWith("../"))
          ) {
            return null;
          }
          for (const ext of [".ts", ".tsx"]) {
            const candidate = source.slice(0, -3) + ext;
            const resolved = await this.resolve(candidate, importer, {
              skipSelf: true,
              ...options,
            });
            if (resolved) return resolved;
          }
          return null;
        },
      },
      ...(viteConfig.plugins ?? []),
    ];
    viteConfig.css = {
      ...(viteConfig.css ?? {}),
      postcss: {
        plugins: [
          tailwindcss({
            content: ["./src/**/*.{ts,tsx}", "./stories/**/*.{ts,tsx}"],
            theme: {
              extend: {
                colors: {
                  background: "hsl(var(--background))",
                  foreground: "hsl(var(--foreground))",
                  card: "hsl(var(--card))",
                  "card-foreground": "hsl(var(--card-foreground))",
                  popover: "hsl(var(--popover))",
                  "popover-foreground": "hsl(var(--popover-foreground))",
                  primary: "hsl(var(--primary))",
                  "primary-foreground": "hsl(var(--primary-foreground))",
                  secondary: "hsl(var(--secondary))",
                  "secondary-foreground": "hsl(var(--secondary-foreground))",
                  muted: "hsl(var(--muted))",
                  "muted-foreground": "hsl(var(--muted-foreground))",
                  accent: "hsl(var(--accent))",
                  "accent-foreground": "hsl(var(--accent-foreground))",
                  destructive: "hsl(var(--destructive))",
                  "destructive-foreground": "hsl(var(--destructive-foreground))",
                  border: "hsl(var(--border))",
                  input: "hsl(var(--input))",
                  ring: "hsl(var(--ring))",
                },
                borderRadius: {
                  lg: "var(--radius)",
                  md: "calc(var(--radius) - 2px)",
                  sm: "calc(var(--radius) - 4px)",
                },
              },
            },
            plugins: [],
          }),
          autoprefixer(),
        ],
      },
    };
    return viteConfig;
  },
};

export default config;
