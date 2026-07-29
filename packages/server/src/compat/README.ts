/**
 * compat — 兼容层包的**子路径转发面**(spec: core-package-extraction,任务 5.2)。
 *
 * `@blksails/pi-web-server` 的四个子路径(`./trust` `./model-options`
 * `./vision-model-options` `./testing`)所指的实现已随内核搬进 `@blksails/pi-web-core`。
 * 本目录下每个文件都是一行 `export *` 的**薄转发**,使既有消费方的导入路径**逐字不变**
 * (R2.1 / R2.5)—— 该包已发布上游,跨仓静默不匹配的代价极高。
 *
 * ★ 转发面只转发,不增不减。想给某个子路径"顺手补一个符号"时请先读 R2.4:
 *   刻意的缺口是刻意的。
 */
export {};
