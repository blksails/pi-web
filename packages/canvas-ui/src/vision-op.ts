/**
 * vision-op — Canvas「解读」按钮的对话通道载荷构造器(spec canvas-vision-readout)。
 *
 * 把「当前工作图 + 问题 + 可选视觉模型」组装成一个 `tool: image_vision` 的 {@link SurfaceOp},
 * 由 `bridge.submitOp` 经 `renderSurfaceOp` 渲染为**用户消息**发进对话流,LLM 据此调用
 * 已实现的 `image_vision` 工具(spec image-vision-tool)。结论因此天然回流对话记录:
 * 可回放、可追问、进 LLM 上下文。
 *
 * 设计要点:
 * - **刻意不复用 `buildSurfaceOp`**:二者 tool 行语义、参数集合、可选项规则完全不同;
 *   强行抽象会把 `generate-actions.test.ts` 的决策守恒线(逐字节断言生成载荷)拖下水。
 * - **tool 行必须内嵌中文指令**:agent 的 systemPrompt **没有**教 LLM 解析 `canvas-op` 围栏,
 *   理解完全依赖 tool 行里的「请直接按下列参数调用,勿追问」(与 `buildSurfaceOp:314` 同形态)。
 *   去掉它,LLM 很可能复述参数而不调用工具。
 * - **`model` 为空时省略该参数行**:`renderSurfaceOp` 跳过空值(surface-op.ts:62),
 *   工具收不到 model 即弹选择层(image-vision-tool Req 3.1);收到则直接用(Req 3.2)。
 * - `model` 的取值是 **`provider/modelId`**(与工具 `model` 参数、`modelKey()` 对齐),
 *   ⚠ 与提示词栏既有「生成模型」选择器的**裸 id** 格式不同,不可混用。
 *
 * 纯函数:零 React、零 I/O、同输入恒同输出。
 *
 * `fetchVisionModels` 是本文件唯一的非纯函数(取数 + 模块级缓存),与设置面板
 * `VisionModelSelectField` 共用同一实现(multi-gateway-providers 任务 6.3)——见其定义处注释。
 * ⚠ 查询串固定为 `?input=image&output=text`(读图**并产出文本**),不可简化为只
 *   `input=image`:后者会把 `output` 为 `image` 的 AIGC 图生图/改图模型一并纳入,污染
 *   「视觉理解模型」清单(六批完整性批评 gap 4,任务 6.3 打回修复的近因)。
 */
import type { SurfaceOp } from "@blksails/pi-web-kit";

/** 输入框为空时使用的默认提问(Req 1.3)。 */
export const DEFAULT_READOUT_QUESTION = "描述这张图片的内容。";

/** 标题中意图摘要的最大长度(与 `buildSurfaceOp` 的 48 字截断同规)。 */
const INTENT_MAX = 48;

/**
 * 视觉模型选项。
 *
 * `value` 是 **`provider/modelId`**(工具 `model` 参数的格式);`label` 供展示。
 */
export interface VisionModelOption {
  readonly value: string;
  readonly label: string;
  readonly provider: string;
}

export interface BuildVisionOpInput {
  /** 当前工作图的附件 id(`att_…`)。 */
  readonly imageId: string;
  /** 用户问题;空串 / 全空白 → 使用 {@link DEFAULT_READOUT_QUESTION}。 */
  readonly question: string;
  /** `provider/modelId`;省略 / 空串 → 载荷不带 `model` 行,由工具弹层选择。 */
  readonly model?: string;
}

/** 标题的意图摘要:超长截断,空则不附。 */
function summarizeIntent(question: string): string {
  const q = question.trim();
  if (q === "") return "";
  return q.length > INTENT_MAX ? `${q.slice(0, INTENT_MAX)}…` : q;
}

/**
 * 构造 `image_vision` 的对话通道载荷。
 *
 * 后置:`params` 顺序恒为 `image → question → model?`;`fence` 恒为 `"canvas-op"`;
 * `model` 为空时结果中**不出现** `model` 项。
 */
export function buildVisionOp(input: BuildVisionOpInput): SurfaceOp {
  const question = input.question.trim() === "" ? DEFAULT_READOUT_QUESTION : input.question;

  const params: Array<readonly [string, string]> = [
    ["image", input.imageId],
    ["question", question],
  ];
  // 空 model 不产生参数行 —— 把「是否弹层」的决策权完整交回工具。
  if (typeof input.model === "string" && input.model.trim() !== "") {
    params.push(["model", input.model]);
  }

  const intent = summarizeIntent(question);
  return {
    title: intent !== "" ? `👁 解读 · ${intent}` : "👁 解读",
    tool: "image_vision(请直接按下列参数调用,勿追问、勿复述参数)",
    params,
    fence: "canvas-op",
  };
}

/**
 * 部署级模型目录条目形状(`GET /config/models` 的 `models[]` 元素;multi-gateway-providers
 * 任务 4.1 统一投影)。视觉清单只关心 `provider`/`id`/`name` 三个字段。
 */
interface CatalogModelEntry {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}
interface CatalogModelsResponse {
  readonly models: readonly CatalogModelEntry[];
}

// ── 取数(模块级 Promise 缓存,按 baseUrl 分桶;测试可注入 fetch 实现)──────────────
// 缓存跨消费面共享(multi-gateway-providers 任务 6.3,Req 11.1/11.2):设置页的视觉模型
// 选择字段与本文件的解读弹层 `useVisionModels` 都调用 `fetchVisionModels`;同一 baseUrl
// 下并发/重复调用只发一次请求。
//
// ⚠ 生产形态下这两处**并不落在同一个桶**:设置字段写死 `"/api"`,而 CanvasPanel 目前唯一的
// 生产挂载形态是 pane(iframe),传的是哨兵 `pane://host`(见下方 isFetchableBase)。缓存共享
// 是本函数的真实性质,但「两处共用一次取数」在当前接线下并不发生 —— 别把它当成已生效的验收。
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setVisionModelCatalogFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
/**
 * baseUrl 是否指向一个真能取数的 HTTP 端点 —— 相对路径(`/api`)或绝对 http(s)。
 * 其余(带非 http scheme 的哨兵,如 pane 车道的 `pane://host`)一律视为「没有端点」。
 */
function isFetchableBase(baseUrl: string): boolean {
  if (baseUrl.startsWith("/")) return true;
  return /^https?:\/\//i.test(baseUrl);
}

const cacheByBaseUrl = new Map<string, Promise<readonly VisionModelOption[]>>();
export function __resetVisionModelCatalogCache(): void {
  cacheByBaseUrl.clear();
}

/**
 * 拉取可用视觉模型清单(Req 9.2, 11.1, 11.2, 11.6)。
 *
 * 唯一部署级目录端点 `GET {baseUrl}/config/models?input=image&output=text`
 * (multi-gateway-providers 任务 4.3/6.3),取代已删除的 `/vision/models`。判据是「读图
 * **并产出文本**」——只按 `input=image` 会把 `output` 为 `image` 的 AIGC 图生图/改图模型
 * 一并纳入,那不是视觉理解清单(六批完整性批评 gap 4)。响应条目为 `{provider,id,name}`;
 * 复合标识 `${provider}/${id}` 由本函数拼装 —— 使 `aigc.json` 里存量的 `visionModel` 值
 * (存的正是这个复合键)格式不变、仍能命中清单(Req 11.6)。
 *
 * **两处消费面共用同一次取数与缓存**(Req 11.1/11.2,任务 6.3):模块级 Promise 缓存按
 * `baseUrl` 分桶,同一 baseUrl 的并发/重复调用共享同一 in-flight/已解析 Promise,不重复
 * 发请求。
 *
 * **任何失败(无 baseUrl / 网络 / 非 2xx / 解析异常 / 形状不符)都返回空数组**,既不抛也
 * 不阻断解读 —— 空清单时载荷不带 `model`,由 `image_vision` 工具弹层兜底;但会留一行可
 * 辨识的 `console.error`(此前的静默失败让「目录端点被删除」这类真实破坏在界面上只表现
 * 为「清单为空」,与「本来就没配模型」无法区分)。
 */
export async function fetchVisionModels(
  baseUrl: string | undefined,
): Promise<readonly VisionModelOption[]> {
  if (baseUrl === undefined || baseUrl === "") return [];
  // pane(iframe)车道传的是哨兵 `pane://host` —— 它不是可取的 URL,而是「本 realm 拿不到宿主
  // baseUrl」的标记(examples/aigc-canvas-agent/web/panes/canvas.tsx:239;pane 里视觉模型的
  // 选择已下沉到 agent,本就不该取数)。不短路的话每次打开 Canvas pane 都会对一个按设计不可达
  // 的 URL 报一次 console.error,把常态路径变成常态报错、并淹没真正的破坏信号。
  if (!isFetchableBase(baseUrl)) return [];
  const cached = cacheByBaseUrl.get(baseUrl);
  if (cached !== undefined) return cached;

  const url = `${baseUrl}/config/models?input=image&output=text`;
  const promise = (async (): Promise<readonly VisionModelOption[]> => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Partial<CatalogModelsResponse>;
      const entries = Array.isArray(body.models) ? body.models : [];
      return entries
        .filter(
          (m): m is CatalogModelEntry =>
            typeof m === "object" &&
            m !== null &&
            typeof (m as CatalogModelEntry).provider === "string" &&
            typeof (m as CatalogModelEntry).id === "string" &&
            typeof (m as CatalogModelEntry).name === "string",
        )
        .map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name, provider: m.provider }));
    } catch (err) {
      console.error(`[fetchVisionModels] GET ${url} failed:`, err);
      return [];
    }
  })();
  cacheByBaseUrl.set(baseUrl, promise);
  return promise;
}
