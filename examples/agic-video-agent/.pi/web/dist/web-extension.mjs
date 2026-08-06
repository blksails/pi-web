// 由 examples/agic-video-agent/build.ts 生成 —— 按 realm 分派到 external / isolated 产物。
const reload = new URL(import.meta.url).search;
let m;
try {
  await import("react");
  m = await import(/* @vite-ignore */ `./web-extension.external.mjs${reload}`);
} catch {
  m = await import(/* @vite-ignore */ `./web-extension.isolated.mjs${reload}`);
}
export default m.default;
