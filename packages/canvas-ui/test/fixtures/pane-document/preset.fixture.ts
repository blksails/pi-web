/**
 * `pane-document.test.ts` 专用的假样式预设。
 *
 * 与真实的 `packages/ui/tailwind-preset.ts` 完全无关,刻意放在 `test/fixtures/` 下(而非
 * `packages/ui/`)——如果 `resolveCanvasCss()` 内部还在按仓库物理路径猜测预设位置
 * (旧实现的 bug),它就找不到、也不会用到本文件,测试断言的独有色值也就不会出现在产出里。
 */
import type { Config } from "tailwindcss";

export const piWebPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        "fixture-marker": "#123456",
      },
    },
  },
};

export default piWebPreset;
