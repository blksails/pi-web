/**
 * 薄转发:实现已随 `model-sources/` 搬入 @blksails/pi-web-adapters
 * (spec: adapters-package-extraction,任务 3.1)。导出面逐字不变。
 *
 * ★ 为什么必须经本目录转发:Node 的 `exports` 目标只能指向**本包内**的相对路径,
 *   无法直接指向别的包。子路径 `@blksails/pi-web-server/model-options` 已发布上游,
 *   改动它的存在与否是跨仓破坏 —— 故留一行转发,而不是把子路径删掉。
 */
export * from "@blksails/pi-web-adapters/model-sources/model-options.js";
