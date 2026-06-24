import type { Config } from "tailwindcss";

/**
 * @blksails/ui Tailwind 预设(pi-chat-customization 任务 1.6)。
 *
 * 将 shadcn CSS 变量到工具类的令牌映射抽为可复用预设,下游 Tailwind 配置经
 * `presets: [piWebPreset]` 一行接入,无需手工重复声明该映射(Req 3.3)。
 * 颜色一律映射到 `hsl(var(--*))`,不硬编码具体色值(Req 3.1)。
 */
export const piWebPreset: Partial<Config> = {
  darkMode: "class",
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
};

export default piWebPreset;
