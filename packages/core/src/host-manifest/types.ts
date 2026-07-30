/**
 * 能力面清单端口 —— 类型契约(spec: host-contract-ports,任务 5.2;Req 6.1-6.7)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5。
 *
 * 存在理由:pi-web 有**唯一**的装配点(`lib/app/pi-handler.ts` 的 routes 数组),而
 * pi-clouds **重写**了它 —— 12 个能力面就此静默消失,零编译信号、零运行时信号,
 * 「漏掉」与「有意弃用」在架构上不可区分。本模块把这件事变成:宿主必须对**每个**
 * 标识显式表态,未表态即**组装期**抛错。
 *
 * 泛型化:路由型 `TRoute` 与依赖型 `TDeps` 均为参数,故本模块**不 import `http/`**、
 * 也不枚举既有工厂的 deps。这既是不改既有装配(Req 10.4)仍能交付引擎的前提,
 * 也让两端各用各自的 HTTP 栈。
 *
 * pi-SDK-free:零外部依赖,可安全经 server 主 barrel 重导出。
 */

/** 能力面工厂:吃宿主依赖,吐该能力面的路由集。 */
export type CapabilityFactory<TDeps, TRoute> = (deps: TDeps) => readonly TRoute[];

/** 一个能力面的描述符。`id` 命名 `<组>.<名>`,一经发布**不得改名**(契约 §5.2 第 4 条)。 */
export interface CapabilityDescriptor<TDeps, TRoute> {
  readonly id: string;
  readonly factory: CapabilityFactory<TDeps, TRoute>;
  /**
   * 依赖的端口名(契约 §5.1)。
   *
   * ⚠ 本期**不校验**:引擎对 `TDeps` 完全泛型化,没有端口名注册表可比对,任何「校验」
   * 都只会是恒真的。校验落点在 M3 接入 `pi-handler.ts`、`TDeps` 收敛为具体依赖对象之后。
   * 此处保留字段以免届时改动描述符形状(那时它已是跨仓公开面)。
   */
  readonly requires?: readonly string[];
}

/**
 * 宿主对某个能力面的表态。三选一,**没有第四种「不说」** —— 那正是本模块要消灭的状态。
 */
export type CapabilityDecision<TDeps, TRoute> =
  /** 沿用默认实现(Req 6.3)。 */
  | { readonly kind: "use" }
  /** 以宿主实现替换默认实现(Req 6.4)。 */
  | { readonly kind: "replace"; readonly factory: CapabilityFactory<TDeps, TRoute> }
  /** 弃用,必须给出非空原因(Req 6.5/6.6)。 */
  | { readonly kind: "decline"; readonly reason: string };

/** 组装失败的判别码。 */
export type CapabilityCompositionErrorCode = "unknown-id" | "missing-decision" | "empty-reason";

/**
 * 组装期失败。
 *
 * ⚠ 判别一律用 `code`,不用 `instanceof` —— 本类会跨包(pi-clouds 引用 pi-web 导出)使用,
 * 同名类可能来自不同模块实例,`instanceof` 会假阴性。与 `WorkspaceError` 同规。
 *
 * `ids` 必须是**具体标识列表**而非计数:宿主拿着列表可以直接补,拿着「缺 3 个」只能自己找。
 */
export class CapabilityCompositionError extends Error {
  constructor(
    public readonly code: CapabilityCompositionErrorCode,
    public readonly ids: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "CapabilityCompositionError";
  }
}

/** {@link composeCapabilities} 的输入。 */
export interface ComposeCapabilitiesInput<TDeps, TRoute> {
  readonly descriptors: readonly CapabilityDescriptor<TDeps, TRoute>[];
  readonly decisions: Readonly<Record<string, CapabilityDecision<TDeps, TRoute>>>;
  readonly deps: TDeps;
  /** 弃用通知,供宿主在启动期记录原因(Req 6.6)。 */
  readonly onDecline?: (id: string, reason: string) => void;
}
