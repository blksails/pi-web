"use client";
/**
 * 并存期垫片(spec vite-spa-migration)。
 *
 * 实现已迁至 `src/theme-controls.tsx`。旧宿主(Next)的 `app/providers.tsx` 仍从此处引入;
 * 旧宿主删除(任务 11)时本文件一并移除。
 */
export {
  ThemeControls,
  ThemeToggleButton,
  LocaleToggleButton,
} from "../src/theme-controls.js";
