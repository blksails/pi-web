/**
 * 自动会话标题扩展(default export 供 pi 按 forcedExtensionPaths 强制注入每个会话)。
 *
 * 在每轮 agent loop 结束(`agent_end`)时据会话内容生成简短标题并 `ctx.ui.setTitle`,标题经
 * 既有链路(setTitle 帧 → react ambient.title → PiChat 渲染)展示,**零协议/零前端改动**。
 *
 * 设计要点:
 * - 核心逻辑抽到 {@link createAutoTitleHandler}(依赖注入 complete / convert / resolveModel),
 *   纯状态机便于单测;default export 仅注入真实 pi-ai `completeSimple` / pi-agent-core
 *   `convertToLlm` / 模型解析。
 * - `once` 模式仅在**成功设置标题后**置位(失败可后续重试,Req 2.2);`refresh` 每轮重设。
 * - `llm` 策略失败/无模型回退启发式(Req 3.2);启发式仍为空则跳过、不设空标题(Req 1.3)。
 * - 全程 try/catch 吞错,绝不抛出、不阻塞会话(Req 7)。
 *
 * 总开关 `PI_WEB_AUTO_TITLE` 不在此读取 —— 由服务端(pi-handler)权威门控「是否下发本扩展入口」,
 * 关闭时扩展根本不注入。
 */
// pi-ai 0.80: `completeSimple` 迁到 `/compat` 子路径(0.79 在主入口);类型仍在主入口。
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { createLogger } from "@blksails/pi-web-logger";
import {
  parseAutoTitleConfig,
  type AutoTitleConfig,
} from "./auto-title-config.js";
import {
  buildTitleContext,
  extractTitleText,
  heuristicTitle,
  sanitizeTitle,
  type AgentMessage,
} from "./title-generator.js";

const log = createLogger({ namespace: "toolkit:auto-title" });

/** 注入式依赖,使标题状态机可在无真实模型下单测。 */
export interface AutoTitleDeps {
  config: AutoTitleConfig;
  /** 一次性模型调用(默认注入 pi-ai completeSimple)。 */
  complete: (model: Model<never>, context: Context) => Promise<AssistantMessage>;
  /** AgentMessage[] → pi-ai Message[](默认注入 pi-agent-core convertToLlm)。 */
  convert: (messages: AgentMessage[]) => Context["messages"];
  /** 解析本次总结所用模型;返回 undefined 表示无可用模型(走启发式)。 */
  resolveModel: (ctx: ExtensionContext) => Model<never> | undefined;
}

/**
 * 用 LLM 策略生成标题;模型缺失/调用失败/空结果时返回 `""`(由调用方回退启发式)。
 */
async function llmTitle(
  event: AgentEndEvent,
  ctx: ExtensionContext,
  deps: AutoTitleDeps,
): Promise<string> {
  const model = deps.resolveModel(ctx);
  if (model === undefined) return "";
  try {
    const context = buildTitleContext(event.messages, deps.convert);
    const res = await deps.complete(model, context);
    return sanitizeTitle(extractTitleText(res), deps.config.maxLen);
  } catch (err) {
    log.debug("auto-title LLM 总结失败,回退启发式", { err: String(err) });
    return "";
  }
}

/**
 * 创建 `agent_end` 处理器。闭包内持有 `hasSetTitle`(once 模式状态),返回的 handler
 * 全程吞错。
 */
export function createAutoTitleHandler(
  deps: AutoTitleDeps,
): ExtensionHandler<AgentEndEvent> {
  let hasSetTitle = false;

  return async (event, ctx) => {
    try {
      // once:成功设置过即不再处理(refresh 永远继续)。
      if (deps.config.mode === "once" && hasSetTitle) return;

      let title = "";
      if (deps.config.strategy === "llm") {
        title = await llmTitle(event, ctx, deps);
        if (title === "") title = heuristicTitle(event.messages, deps.config.maxLen);
      } else {
        title = heuristicTitle(event.messages, deps.config.maxLen);
      }

      // 无可总结内容 → 跳过,不设空标题(Req 1.3 / 7.3)。
      if (title === "") return;

      ctx.ui.setTitle(title);
      if (deps.config.mode === "once") hasSetTitle = true;
      log.debug("auto-title 已设置标题", { mode: deps.config.mode, title });
    } catch (err) {
      // 任何异常静默吞掉,绝不阻塞会话(Req 7.1)。
      log.debug("auto-title 处理 agent_end 异常(已忽略)", { err: String(err) });
    }
  };
}

/**
 * 解析总结所用模型:配置了 `provider/modelId` 则经 registry 查找,查不到/未配置回退
 * 会话当前模型(`ctx.model`)。
 */
function resolveTitleModel(
  ctx: ExtensionContext,
  configModel: string | undefined,
): Model<never> | undefined {
  if (configModel !== undefined) {
    const slash = configModel.indexOf("/");
    if (slash > 0) {
      const found = ctx.modelRegistry.find(
        configModel.slice(0, slash),
        configModel.slice(slash + 1),
      );
      if (found !== undefined) return found as Model<never>;
    }
  }
  return ctx.model as Model<never> | undefined;
}

/**
 * 总开关判定(spec: runner-self-resolved-builtins,任务 2.2;Req 3.2)。
 *
 * 改造前该判定在**主进程**:关闭时不下发本扩展入口 → 扩展根本不注入。改为 runner 侧自解析后
 * 入口**恒被解析**,故判定必须下沉到此处 —— 关闭时不注册 handler(扩展空转),使
 * 「`PI_WEB_AUTO_TITLE=0` = 无效果」这一用户可观察结果与改造前**逐字等价**。
 *
 * 语义沿用主进程原判据:`!== "0"` 即启用(未设置=默认启用)。
 */
export function isAutoTitleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["PI_WEB_AUTO_TITLE"] !== "0";
}

/** pi 扩展入口:解析配置并注册 agent_end 处理器(总开关关闭时不注册)。 */
export default function autoTitleExtension(pi: ExtensionAPI): void {
  if (!isAutoTitleEnabled()) return;
  const config = parseAutoTitleConfig(process.env);
  const handler = createAutoTitleHandler({
    config,
    complete: (model, context) => completeSimple(model, context),
    convert: (messages) => convertToLlm(messages),
    resolveModel: (ctx) => resolveTitleModel(ctx, config.model),
  });
  pi.on("agent_end", handler);
}
