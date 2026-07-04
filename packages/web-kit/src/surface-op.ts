/**
 * web-kit — surface-op:surface 操作描述与提交结果类型。
 *
 * 应用面把一次领域操作组装成与通道无关的 {@link SurfaceOp}(标题 / 工具 / 有序参数),
 * 由门面按 opChannel 分道:prompt 态经纯函数 `renderSurfaceOp` 渲染为用户消息文本,
 * command 态经 `fallback` 走控制面命令。提交结果一律以 {@link SubmitOpResult}(discriminated
 * union)承载,降级是常态不以异常表达(契约 §4.5 / C3-4)。
 *
 * 类型落 web-kit(框架无关、canonical 家);渲染纯函数与门面 hook 在其上层组装。
 */
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";

/**
 * surface 操作描述(契约 §4.5 草图的实化)。领域内容由应用面组装,通道实现由门面消费;
 * `params` 用有序对(键值对数组)保证渲染输出的确定性(同输入恒同输出)。
 */
export interface SurfaceOp {
  /** 人读标题行(应用面组装,可含 emoji 与意图摘要;领域内容)。 */
  readonly title: string;
  /** 工具行内容(值可携带领域注解,原样透传)。 */
  readonly tool: string;
  /** 参数行,按序输出;值可携带领域注解。 */
  readonly params: ReadonlyArray<readonly [key: string, value: string]>;
  /** fence 语言,默认 `"surface-op"`;canvas 传 `"canvas-op"` 保持既有输出。 */
  readonly fence?: string;
  /** 控制面等价命令(command 态降级依据;未声明则 command 态不可提交)。 */
  readonly fallback?: { readonly action: string; readonly args?: unknown };
}

/**
 * 提交结果(discriminated union;契约 C3-4)。prompt 态成功仅报通道;command 态成功透传
 * 控制面 {@link SurfaceCommandResult};失败以可观察错误对象承载(不静默、不抛异常):
 * `no_fallback`(command 态缺 fallback)/ `unavailable`(无任何可用通道)。
 */
export type SubmitOpResult =
  | { readonly ok: true; readonly channel: "prompt" }
  | { readonly ok: true; readonly channel: "command"; readonly result: SurfaceCommandResult }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "no_fallback" | "unavailable";
        readonly message: string;
      };
    };

/** fence 语言默认值(未声明 `op.fence` 时使用;契约 C3-1 运行时约定)。 */
const DEFAULT_FENCE = "surface-op";

/**
 * 组装器纯函数(契约 C3-1):把 {@link SurfaceOp} 渲染为
 * `${title}\n\n\`\`\`${fence}\ntool: ${tool}\n${k}: ${v}…\n\`\`\`` 形态的用户消息文本。
 *
 * - 标题与 fence 间恰好一个空行;工具行恒在参数之上;参数按 `params` 插入序输出(3.1)。
 * - 值为空串或 undefined 的参数行省略,与现行 canvas 组装省略语义对齐(3.2)。
 * - 纯函数:同输入恒同输出、无副作用(3.3;不改动入参、不 trim 值内领域注解)。
 */
export function renderSurfaceOp(op: SurfaceOp): string {
  const fence = op.fence ?? DEFAULT_FENCE;
  const lines: string[] = [`tool: ${op.tool}`];
  for (const [key, value] of op.params) {
    // 空值参数行省略(3.2);非空值原样透传,不裁剪、不 trim。
    if (value === undefined || value === "") continue;
    lines.push(`${key}: ${value}`);
  }
  return `${op.title}\n\n\`\`\`${fence}\n${lines.join("\n")}\n\`\`\``;
}
