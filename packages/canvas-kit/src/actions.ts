/**
 * actions — defineCanvasAction / resolveAction(L2 动作契约唯一家;task 1.1,
 * Req 1.1/1.2/1.3/1.5/1.7 与 4.5)。
 *
 * design.md「canvas-kit · actions.ts(核心契约)」:把「生成什么、怎么生成」从封闭
 * if 链改为评分制动作插件链。动作以对象字面量声明(何时适用 match / 参数怎么构造
 * buildArgs / 走哪条执行通道 execution),resolveAction 为不依赖外部可变状态的纯函数
 * 决策器 —— 全分支可独立单测(1.7),六内置动作自举 = 行为回归线。
 *
 * 封装线(canvas-kit 零 @blksails 硬线):本模块只声明结构类型与纯函数,不 import 任何
 * @blksails/* 包或 react;prompt 通道载荷以 TOp 泛型表达(canvas-ui 实例化为 SurfaceOp),
 * 契约不引 SurfaceOp。TypeScript strict 禁 any(泛型 TOp + Record<string, unknown>)。
 */

// ── CanvasCapability(agent 权威能力清单)──────────────────────────────────────

/**
 * agent 权威能力清单(结构类型;tool-kit zod 推断类型与之双向可赋值,经 canvas-ui
 * 静态断言防漂移)。capability 缺失时以空清单(models/sizes/actions 皆 [])喂入,
 * match 据此避让,command 动作全被白名单排除(4.5 退化路径)。
 */
export interface CanvasCapability {
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly label?: string;
    /** 该模型受支持尺寸集(缺省=不收窄,全局 sizes 全可用)。 */
    readonly sizes?: readonly string[];
  }>;
  readonly sizes: ReadonlyArray<{ readonly label: string; readonly size: string }>;
  /** agent 支持的 command 动作白名单(拍板①:仅供声明消费,不自动长 UI)。 */
  readonly actions: readonly string[];
}

// ── ActionInput(决策输入)────────────────────────────────────────────────────

/**
 * 决策输入(≈ 既有 GenerateDecisionInput + capability;字段语义与现 decideGenerate
 * 逐项一致)。capability 恒非 undefined —— 缺失以空清单常量表达(4.5 避让判断输入)。
 */
export interface ActionInput {
  readonly imageId: string;
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly variants: number;
  readonly hasMask: boolean;
  readonly hasExpand: boolean;
  readonly referenceIds: readonly string[];
  readonly capability: CanvasCapability;
}

// ── CanvasActionPlugin / defineCanvasAction(1.1)──────────────────────────────

/**
 * 动作插件。TOp = prompt 通道载荷类型(canvas-ui 实例化为 SurfaceOp;canvas-kit
 * 零依赖故泛型)。execution 二选一:对话流通道(via:"prompt",带 buildOp 构造载荷)
 * 或命令通道(via:"command",声明 command 名,须落在 capability.actions 白名单内)。
 */
export interface CanvasActionPlugin<TOp = unknown> {
  readonly id: string; // "builtin:inpaint" / "acme:style-transfer"
  readonly label: string; // 生成按钮标签(替 ACTION_LABEL)
  /** 评分制:false=不适用;数值越大越优先。同分取注册序先者。纯函数(1.7)。 */
  match(input: ActionInput): number | false;
  /** 命令/op 参数构造(纯函数;不含二进制,资产 att_ 由调用方编排后补充,如 inpaint mask)。 */
  buildArgs(input: ActionInput): Record<string, unknown>;
  readonly execution:
    | { readonly via: "prompt"; buildOp(args: Record<string, unknown>, input: ActionInput): TOp }
    | { readonly via: "command"; readonly command: string };
}

/** 声明式定义(恒等 + TOp 类型收窄;defineCanvasTool 先例)。 */
export function defineCanvasAction<TOp = unknown>(
  action: CanvasActionPlugin<TOp>,
): CanvasActionPlugin<TOp> {
  return action;
}

// ── resolveAction(纯函数决策器,1.2/1.3/1.5/1.7 与 4.5)────────────────────────

export interface ResolvedAction<TOp = unknown> {
  readonly plugin: CanvasActionPlugin<TOp>;
  readonly args: Record<string, unknown>;
  readonly score: number;
}

export interface ResolveActionOptions {
  /** match/buildArgs 抛错回调(调用方记 diagnostics);抛错动作按不适用隔离(1.5)。 */
  onError?(actionId: string, error: unknown): void;
}

/**
 * 纯注册表决策(1.2/1.3/1.5/1.7 与 4.5):
 * - via:"command" 且 command ∉ input.capability.actions 的动作先行排除(4.5);
 * - match 返回 false 排除(1.3);match 抛错经 onError 上报 + 按不适用隔离(1.5);
 * - 候选按数值分降序、同分取注册序先者(稳定,1.2);
 * - 依序对候选执行 buildArgs:抛错者经 onError 上报后剔除、重选次优(1.5);
 * - 空候选 / 全部剔除 → null。
 * 不修改入参;同输入同输出(1.7)。
 */
export function resolveAction<TOp>(
  actions: readonly CanvasActionPlugin<TOp>[],
  input: ActionInput,
  opts?: ResolveActionOptions,
): ResolvedAction<TOp> | null {
  const whitelist = input.capability.actions;
  const candidates: Array<{ plugin: CanvasActionPlugin<TOp>; score: number; order: number }> = [];

  actions.forEach((plugin, order) => {
    // via:"command" 白名单先行排除(4.5):无白名单授权的命令动作不参与决策。
    if (plugin.execution.via === "command" && !whitelist.includes(plugin.execution.command)) {
      return;
    }
    let score: number | false;
    try {
      score = plugin.match(input);
    } catch (error) {
      // match 抛错隔离(1.5):上报 + 视为不适用,决策继续。
      opts?.onError?.(plugin.id, error);
      return;
    }
    if (score === false) return; // false 排除(1.3)
    candidates.push({ plugin, score, order });
  });

  // 数值分降序;同分按注册序(order 升序)取先者 —— 稳定(1.2)。
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);

  // 依序尝试 buildArgs:winner 抛错则剔除、重选次优(1.5)。
  for (const candidate of candidates) {
    let args: Record<string, unknown>;
    try {
      args = candidate.plugin.buildArgs(input);
    } catch (error) {
      opts?.onError?.(candidate.plugin.id, error);
      continue;
    }
    return { plugin: candidate.plugin, args, score: candidate.score };
  }
  return null;
}
