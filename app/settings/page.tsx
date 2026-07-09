"use client";
/**
 * 并存期垫片(spec vite-spa-migration)。
 *
 * 实现已迁至 `src/routes/settings.tsx`。旧宿主删除(任务 11)时本文件一并移除。
 */
import { SettingsRoute } from "@/src/routes/settings.js";

export default function SettingsPage(): React.JSX.Element {
  return <SettingsRoute />;
}
