/**
 * session-snapshot-authority(STEP4)— pi data-part 类型单一真相源(PART_KINDS)。
 *
 * 把散落 5 处、靠字符串字面量手工对齐的 data-part `type` 收口为一张**单一真相源**:
 * 每个 kind 关联其校验 schema、服务端事件来源、以及前端**消费方式**。`PartKind = keyof`
 * 使 kind 成为受检类型(拼写错误编译期报错,消除字符串字面量漂移,Req 6.1/6.2)。
 *
 * 消费方式(consume):
 *   - "registry":经前端 renderer-registry(registerDataPartRenderer)按 type 分发到组件
 *     (data-pi-ui)。这是「孤儿渲染器」风险所在——契约测试遍历断言
 *     每个此类 kind 都有注册的渲染器(Req 6.5)。
 *   - "stream":由消息流上层 UI 直接消费(顶部状态条 / 队列视图),不经 renderer-registry
 *     (data-pi-queue / data-pi-compaction / data-pi-auto-retry)。
 *
 * 依赖方向:protocol 仅含 schema 与元数据,不引用任何渲染组件(渲染映射在 ui 层)。
 */
import type { z } from "zod";
import {
  AutoRetryDataPartSchema,
  CompactionDataPartSchema,
  QueueDataPartSchema,
  UiDataPartSchema,
} from "./data-part.js";

/** 单个 data-part kind 的契约元数据。 */
export interface PartKindDef {
  /** 该 kind 的 zod 校验 schema(与 DataPartSchema 联合成员同一引用)。 */
  readonly schema: z.ZodTypeAny;
  /** 前端消费方式:registry(经渲染器注册表)/ stream(上层 UI 直接消费)。 */
  readonly consume: "registry" | "stream";
  /** 服务端事件来源(翻译标识,文档/诊断用)。 */
  readonly fromEvent: string;
}

/**
 * pi data-part 单一真相源。新增一种 data-part 仅需在此登记一条:
 * 类型强制 PartKind 联合更新;若标 consume:"registry" 则契约测试强制存在渲染器。
 */
export const PART_KINDS = {
  "data-pi-queue": {
    schema: QueueDataPartSchema,
    consume: "stream",
    fromEvent: "queue_update",
  },
  "data-pi-compaction": {
    schema: CompactionDataPartSchema,
    consume: "stream",
    fromEvent: "compaction_start|compaction_end",
  },
  "data-pi-auto-retry": {
    schema: AutoRetryDataPartSchema,
    consume: "stream",
    fromEvent: "auto_retry_start|auto_retry_end",
  },
  "data-pi-ui": {
    schema: UiDataPartSchema,
    consume: "registry",
    fromEvent: "tool_execution_update.details(UiSpec)",
  },
} as const satisfies Record<string, PartKindDef>;

/** 受检的 data-part kind 联合(由 PART_KINDS 键派生;拼错即编译期报错)。 */
export type PartKind = keyof typeof PART_KINDS;

/**
 * consume:"registry" 的 kind 子集——**类型层收窄**(映射条件类型),不是运行期 filter。
 * 用它给前端渲染器映射 `Record<RegistryPartKind, …>`,使「新增 registry kind 却忘记渲染器」
 * 在**编译期**即报 missing property(STEP4 静态保证的方向正确性,Req 6.5)。
 */
export type RegistryPartKind = {
  [K in PartKind]: (typeof PART_KINDS)[K]["consume"] extends "registry" ? K : never;
}[PartKind];

/** 经渲染器注册表分发的 kind 列表(运行期,供契约测试遍历);元素类型收窄为 RegistryPartKind。 */
export const REGISTRY_PART_KINDS: readonly RegistryPartKind[] = (
  Object.keys(PART_KINDS) as PartKind[]
).filter((k): k is RegistryPartKind => PART_KINDS[k].consume === "registry");
