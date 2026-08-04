/**
 * model-catalog · Modality —— 输入 / 输出类型维度的取值域、缺省补齐、继承覆盖、
 * 筛选谓词单一权威(multi-gateway-providers spec design.md「core / Modality」组件块,
 * Req 4.1–4.3, 4.6, 4.7)。
 *
 * 取值域由**本产品维护**,不受上游 pi SDK 的两值联合(`Model` 无 output)约束 ——
 * 这正是 Req 4.2 要求的可扩展性:新增取值只改本文件,不牵动上游契约。
 */

/** 本产品自有的输入 / 输出类型取值域(Req 4.2)。 */
export type Modality = "text" | "image" | "video" | "audio";

/** 全部合法取值,供归一化时做成员校验。 */
const MODALITY_VALUES: ReadonlySet<string> = new Set<Modality>([
  "text",
  "image",
  "video",
  "audio",
]);

/** 对话模型缺省输出(Req 4.3:上游未声明输出时按对话缺省补齐)。 */
const DEFAULT_OUTPUT: readonly Modality[] = ["text"];

/** 按输入方向、输出方向或两者组合筛选(Req 4.1 的消费面契约)。 */
export interface ModalityFilter {
  readonly input?: Modality;
  readonly output?: Modality;
}

function toModalityArray(values: readonly string[] | undefined): readonly Modality[] {
  if (values === undefined) return [];
  return values.filter((v): v is Modality => MODALITY_VALUES.has(v));
}

/**
 * SDK 值 → 本产品取值域。SDK 的 `Model` 不带 output 声明时,按对话模型缺省
 * 补齐为 `["text"]`(Req 4.3),使全部条目形状一致。非法/未识别取值被静默剔除,
 * 不牵连其余合法取值。
 */
export function normalizeModalities(m: {
  readonly input?: readonly string[];
  readonly output?: readonly string[];
}): { input: readonly Modality[]; output: readonly Modality[] } {
  const input = toModalityArray(m.input);
  const output = m.output === undefined ? DEFAULT_OUTPUT : toModalityArray(m.output);
  return { input, output };
}

/**
 * provider 级声明 → 模型级继承(Req 4.6)。模型自身声明的方向优先,
 * 覆盖其 provider 的继承值(Req 4.7);模型未声明的方向才落到 provider 的值。
 */
export function inheritModalities(
  provider: {
    readonly input?: readonly Modality[];
    readonly output?: readonly Modality[];
  },
  model: {
    readonly input?: readonly Modality[];
    readonly output?: readonly Modality[];
  },
): { input: readonly Modality[]; output: readonly Modality[] } {
  return {
    input: model.input ?? provider.input ?? [],
    output: model.output ?? provider.output ?? [],
  };
}

/**
 * 按输入方向、输出方向或两者组合匹配(Req 4.1)。未指定的方向视为通配;
 * 两个方向都指定时须同时满足。
 */
export function matchesFilter(
  m: { readonly input: readonly Modality[]; readonly output: readonly Modality[] },
  f: ModalityFilter,
): boolean {
  if (f.input !== undefined && !m.input.includes(f.input)) return false;
  if (f.output !== undefined && !m.output.includes(f.output)) return false;
  return true;
}
