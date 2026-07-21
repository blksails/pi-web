/**
 * 深度合并语义(spec: host-contract-ports,任务 2.3;Req 2.3/2.4)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3.4「deepMerge 语义」。
 *
 * ★ 本实现须与既有 `config/config-codec.ts` 的 `deepMerge` **逐项一致**——后续阶段
 * `ConfigCodec` 会改建于 Workspace 之上,两者语义若有差,迁移时会以「配置莫名丢字段」
 * 的形态暴露,且极难归因。故此处刻意复刻其规则,包括下面这条容易被"优化"掉的:
 *
 *  - **`undefined` 值同样写入,不被跳过。** 既有实现遍历 `Object.entries(incoming)`,
 *    对值为 `undefined` 的键执行 `result[key] = undefined`。看似应当"忽略未定义值"更
 *    干净,但那会改变语义:调用方以 `{ a: undefined }` 显式覆盖时行为不同。落盘时
 *    `JSON.stringify` 会丢弃 undefined,故磁盘态一致;差异只在内存态——正因如此更须
 *    对齐,否则迁移期两条路径的内存态不同而磁盘态相同,问题只在特定时序下才显形。
 *
 * 规则:
 *  - 双方同为**非 null 非数组的对象** → 递归合并;
 *  - 其余(标量 / null / 数组 / 类型不匹配)→ **incoming 整体覆盖**;
 *  - 数组**整体替换**,不做逐元素合并或拼接。
 *
 * 纯函数:不修改入参;同输入恒同输出。pi-SDK-free。
 */
import type { JsonObject } from "./types.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 深度合并 `incoming` 到 `base`,返回新对象(Req 2.3)。
 *
 * 对应 `writeJson` 的缺省合并模式;`merge: false` 时调用方直接使用 `incoming`,
 * 使既有值中本次未提供的字段被删除(Req 2.4),不经本函数。
 */
export function deepMergeJson(base: JsonObject, incoming: JsonObject): JsonObject {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const existing = result[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      result[key] = deepMergeJson(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
