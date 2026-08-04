/**
 * pane 来源合并(spec host-builtin-panes,任务 2.1/2.2/2.3)。
 *
 * 把若干 pane 来源(宿主内置、agent 声明,将来可能有第三类)折叠为单一 `PanesDefinition`。
 * 纯函数:无 I/O、无 React、无全局状态、**不打日志** —— 诊断由调用方按 `rejections` 输出。
 *
 * ## 三条设计约束
 *
 * 1. **结构合法性不自证**,一律交 {@link definePanes}。它已实现标识唯一、实例上限、初始集合
 *    存在性与同时打开上限的全部校验;自建第二套必然与它漂移。
 * 2. **顺序权威**:输出顺序只由输入来源顺序 × 各来源内声明顺序决定,不受装载时序影响。
 *    宿主内置在前、agent 在后 —— 由调用方按此顺序传入。
 * 3. **单来源非法只淘汰该来源**。逐来源单独校验后再整体校验,否则无法区分「哪个来源非法」,
 *    诊断会指错。
 *
 * ## 为什么用保留命名空间,而不是「谁覆盖谁」规则
 *
 * 内置 pane 将来要承载文件读写等宿主能力(见 spec `pane-host-capabilities`),身份被顶替
 * 等于权限被窃取。与其定义一条覆盖规则再去守它,不如让标识冲突**结构上不可能**:内置
 * 一律带 {@link HOST_PANE_ID_PREFIX},agent 用该前缀即被拒。同一手法的先例是内置 MCP
 * 条目的 id 冻结。
 */
import { definePanes, type PanesDefinition, type PanesDefinitionInput } from "./contract.js";

/**
 * 保留给宿主内置 pane 的标识前缀。
 *
 * 内置 pane 的标识**必须**以此开头;agent 声明的 pane 使用该前缀即被拒绝。改动此前缀会让
 * 既有内置 pane 标识全部失效 —— 属于 spec 的 Revalidation Trigger。
 */
export const HOST_PANE_ID_PREFIX = "host:";

export type PaneSourceKind = "builtin" | "agent";

export interface PaneSource {
  readonly kind: PaneSourceKind;
  /** 来源标识,仅用于诊断溯源(如 agent 的 manifestId、内置来源的 `"builtin"`)。 */
  readonly origin: string;
  readonly definition: PanesDefinitionInput;
}

export type PaneRejectionReason =
  /** agent 冒用了内置保留前缀,或内置 pane 漏了该前缀。 */
  | "reserved-namespace"
  /** 该来源(或剔除违规 pane 后的残余)不满足结构约束。 */
  | "invalid-definition"
  /** 与已接纳的 pane 标识重复。 */
  | "duplicate-pane-id";

export interface PaneMergeRejection {
  readonly origin: string;
  readonly kind: PaneSourceKind;
  /** `source` = 整个来源被淘汰;`panes` = 仅其中列出的 pane 被淘汰。 */
  readonly scope: "source" | "panes";
  readonly paneIds: readonly string[];
  readonly reason: PaneRejectionReason;
  readonly detail: string;
}

export interface PaneMergeResult {
  /** 合并且校验通过的定义;所有来源都被淘汰时为 `undefined`。 */
  readonly definition: PanesDefinition | undefined;
  /** 淘汰记录。调用方据此输出诊断;为空表示全部来源都被完整接纳。 */
  readonly rejections: readonly PaneMergeRejection[];
}

/** 合并后定义的标识:固定值,便于宿主侧实例存储按稳定 key 归档。 */
const MERGED_DEFINITION_ID = "host-merged";

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取 pane 数组里各项的 `id`(此时尚未校验,故按未知结构安全取值)。 */
function paneIdOf(pane: unknown): string | undefined {
  if (typeof pane !== "object" || pane === null) return undefined;
  const id = (pane as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

interface AcceptedSource {
  readonly source: PaneSource;
  readonly definition: PanesDefinition;
}

/**
 * 按来源类型剔除违反命名空间约定的 pane。
 *
 * agent 冒用保留前缀 → 剔除这些 pane,**该来源其余 pane 仍保留**(不连坐)。
 * 内置漏前缀 → 同样剔除,因为它会让「内置身份 = 带前缀」这一前提失效。
 */
function partitionByNamespace(source: PaneSource): {
  readonly kept: readonly unknown[];
  readonly violatingIds: readonly string[];
} {
  const kept: unknown[] = [];
  const violatingIds: string[] = [];
  for (const pane of source.definition.panes) {
    const id = paneIdOf(pane);
    // id 缺失或非字符串:不在命名空间层判定,留给 definePanes 报结构错误。
    if (id === undefined) {
      kept.push(pane);
      continue;
    }
    const hasPrefix = id.startsWith(HOST_PANE_ID_PREFIX);
    const shouldHavePrefix = source.kind === "builtin";
    if (hasPrefix === shouldHavePrefix) {
      kept.push(pane);
    } else {
      violatingIds.push(id);
    }
  }
  return { kept, violatingIds };
}

/**
 * 逐来源校验:剔除命名空间违规项后,单独过一遍 `definePanes`。
 *
 * 单独校验的意义在于**归因** —— 整体校验失败时无法判断是哪个来源的问题,而诊断指错比没有
 * 诊断更糟。
 */
function acceptSource(
  source: PaneSource,
  rejections: PaneMergeRejection[],
): AcceptedSource | undefined {
  const { kept, violatingIds } = partitionByNamespace(source);
  if (violatingIds.length > 0) {
    rejections.push({
      origin: source.origin,
      kind: source.kind,
      scope: "panes",
      paneIds: violatingIds,
      reason: "reserved-namespace",
      detail:
        source.kind === "agent"
          ? `agent 声明的 pane 不得使用宿主保留前缀 "${HOST_PANE_ID_PREFIX}"`
          : `内置 pane 的标识必须以 "${HOST_PANE_ID_PREFIX}" 开头`,
    });
  }
  if (kept.length === 0 && violatingIds.length > 0) {
    // 全部 pane 都违规 → 该来源无内容可并,但这不是「来源非法」,已按 panes 粒度记过了。
    return undefined;
  }
  // ★ `kept` 为空且无违规记录 = 该来源本来就没有 pane。**不能**在此静默返回 —— 那会让一个
  // 空来源被无声淘汰,调用方拿不到任何诊断(违反 Req 7.1)。继续往下走,由 `definePanes` 的
  // `panes.min(1)` 报结构错误并记成 invalid-definition。
  // 单来源校验时不带 initialPaneIds:被剔除的 pane 可能正在其中,那属于命名空间违规的
  // 连带后果,不该二次报成「初始 pane 不存在」。初始集合在合并层统一过滤后再校验。
  const probe: PanesDefinitionInput = {
    id: source.definition.id,
    panes: kept as PanesDefinitionInput["panes"],
    ...(source.definition.maxOpenPanes !== undefined
      ? { maxOpenPanes: source.definition.maxOpenPanes }
      : {}),
  };
  try {
    return { source, definition: definePanes(probe) };
  } catch (error) {
    rejections.push({
      origin: source.origin,
      kind: source.kind,
      scope: "source",
      paneIds: kept.map((pane) => paneIdOf(pane) ?? "<unknown>"),
      reason: "invalid-definition",
      detail: errorDetail(error),
    });
    return undefined;
  }
}

/**
 * 合并若干 pane 来源。
 *
 * 上限取各来源声明值的**最大者**:agent 原有的可同时打开数量不因内置 pane 的加入而缩水。
 *
 * 初始打开集合:**agent 的完整保留**,内置的默认打开项仅在追加后仍不超上限时才追加。
 * 越界时丢弃的是内置项 —— agent 的会话形态是它自己设计的,宿主不该挤掉它。
 */
export function mergePaneSources(sources: readonly PaneSource[]): PaneMergeResult {
  const rejections: PaneMergeRejection[] = [];
  const accepted: AcceptedSource[] = [];
  for (const source of sources) {
    const result = acceptSource(source, rejections);
    if (result !== undefined) accepted.push(result);
  }
  if (accepted.length === 0) return { definition: undefined, rejections };

  const panes: PanesDefinition["panes"][number][] = [];
  const seen = new Set<string>();
  for (const { source, definition } of accepted) {
    for (const pane of definition.panes) {
      if (seen.has(pane.id)) {
        rejections.push({
          origin: source.origin,
          kind: source.kind,
          scope: "panes",
          paneIds: [pane.id],
          reason: "duplicate-pane-id",
          detail: `pane 标识 "${pane.id}" 与先前来源重复,后者被丢弃`,
        });
        continue;
      }
      seen.add(pane.id);
      panes.push(pane);
    }
  }
  if (panes.length === 0) return { definition: undefined, rejections };

  const maxOpenPanes = Math.max(...accepted.map(({ definition }) => definition.maxOpenPanes));

  // 初始集合:agent 优先、内置后补,且只保留仍然存在的 pane(其来源可能被整体淘汰)。
  const agentInitial: string[] = [];
  const builtinInitial: string[] = [];
  for (const { source, definition } of accepted) {
    const declared = source.definition.initialPaneIds ?? [];
    const bucket = source.kind === "agent" ? agentInitial : builtinInitial;
    for (const id of declared) {
      if (seen.has(id)) bucket.push(id);
    }
  }
  const initialPaneIds = [...agentInitial];
  for (const id of builtinInitial) {
    if (initialPaneIds.length >= maxOpenPanes) break;
    initialPaneIds.push(id);
  }

  const merged: PanesDefinitionInput = {
    id: MERGED_DEFINITION_ID,
    panes: panes as PanesDefinitionInput["panes"],
    maxOpenPanes,
    ...(initialPaneIds.length > 0 ? { initialPaneIds } : {}),
  };
  try {
    return { definition: definePanes(merged), rejections };
  } catch (error) {
    // 跨来源组合非法 —— 无法归因到单一来源,故记为无 origin 的整体失败。
    // 设计上初始集合的合成规则已保证不越界,走到这里说明有未预期的组合约束。
    rejections.push({
      origin: "<merged>",
      kind: "builtin",
      scope: "source",
      paneIds: panes.map((pane) => pane.id),
      reason: "invalid-definition",
      detail: `合并结果不满足结构约束: ${errorDetail(error)}`,
    });
    return { definition: undefined, rejections };
  }
}
