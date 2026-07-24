/**
 * 能力面组装引擎(spec: host-contract-ports,任务 5.2;Req 6.2-6.7)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5.2。
 *
 * 关键不在「组装」而在**强制表态**:所有校验都在产出任何路由之前完成,失败即抛,
 * 于是「宿主漏了一个能力面」从运行期的 404 变成组装期的启动失败。
 *
 * pi-SDK-free:纯函数,零外部依赖。
 */
import {
  CapabilityCompositionError,
  type CapabilityDecision,
  type CapabilityDescriptor,
  type CapabilityFactory,
  type ComposeCapabilitiesInput,
} from "./types.js";

/**
 * 描述符与其表态的配对。
 *
 * 存在理由是**类型**而非便利:`decisions` 是 `Record<string, …>`,索引取值在
 * `noUncheckedIndexedAccess` 下恒为 `T | undefined`,而 `undefined` 混进联合会让
 * `decision.kind === "decline"` 这类判别式**整体失效**(TS 报「reason 不存在于
 * CapabilityDecision」)。此时若用 `!` 或 `as` 压红,判别联合的收窄就退化成了断言 ——
 * 三个变体各自带什么字段正是本模块的核心语义。故改为在缺失表态校验的同一趟里把
 * `undefined` 剔干净,后续所有分流都在**非可选**的 `decision` 上做真实收窄。
 */
interface ResolvedCapability<TDeps, TRoute> {
  readonly descriptor: CapabilityDescriptor<TDeps, TRoute>;
  readonly decision: CapabilityDecision<TDeps, TRoute>;
}

/**
 * 按宿主表态组装能力面路由。
 *
 * 校验顺序为**先未知标识、后缺失表态**(契约 §5.2)。顺序是刻意的:宿主把 `config.mcp`
 * 拼成 `config.mpc` 时,若先报缺失,他会同时收到「缺 config.mcp」与「多 config.mpc」
 * 两条互相矛盾的抱怨,还得自己把它们对上;先报未知则直指打字错误本身。
 *
 * @returns 沿用/替换的能力面按**描述符顺序**拼接的路由集;弃用的不产出任何路由。
 * @throws {CapabilityCompositionError} `unknown-id` / `missing-decision` / `empty-reason`,
 *   均携带**具体标识列表**。
 */
export function composeCapabilities<TDeps, TRoute>(
  input: ComposeCapabilitiesInput<TDeps, TRoute>,
): readonly TRoute[] {
  const { descriptors, decisions, deps, onDecline } = input;
  const known = new Set(descriptors.map((d) => d.id));

  // ① 未知标识:表态指向了名册外的 id。
  const unknown = Object.keys(decisions).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new CapabilityCompositionError(
      "unknown-id",
      unknown,
      `unknown capability id(s) in decisions: ${unknown.join(", ")}`,
    );
  }

  // ② 缺失表态:名册里有、宿主没说话的 id。这是本模块存在的全部理由。
  const resolved: ResolvedCapability<TDeps, TRoute>[] = [];
  const missing: string[] = [];
  for (const descriptor of descriptors) {
    const decision = decisions[descriptor.id];
    if (decision === undefined) {
      missing.push(descriptor.id);
      continue;
    }
    resolved.push({ descriptor, decision });
  }
  if (missing.length > 0) {
    throw new CapabilityCompositionError(
      "missing-decision",
      missing,
      `missing capability decision(s): ${missing.join(", ")}. ` +
        "Every capability must be explicitly used, replaced, or declined with a reason.",
    );
  }

  // ③ 空白弃用原因:`decline` 不给理由等于静默消失换了个写法。一次性列全,不逐个报。
  const emptyReason = resolved
    .filter(({ decision }) => decision.kind === "decline" && decision.reason.trim().length === 0)
    .map(({ descriptor }) => descriptor.id);
  if (emptyReason.length > 0) {
    throw new CapabilityCompositionError(
      "empty-reason",
      emptyReason,
      `declined capability id(s) with blank reason: ${emptyReason.join(", ")}`,
    );
  }

  // 校验全过之后才开始调用工厂 —— 抛错前不得产生任何工厂副作用。
  const routes: TRoute[] = [];
  for (const { descriptor, decision } of resolved) {
    if (decision.kind === "decline") {
      onDecline?.(descriptor.id, decision.reason);
      continue;
    }
    const factory: CapabilityFactory<TDeps, TRoute> =
      decision.kind === "replace" ? decision.factory : descriptor.factory;
    routes.push(...factory(deps));
  }
  return routes;
}
