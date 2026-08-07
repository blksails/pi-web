/**
 * ai-gateway · 会话模型清单的**反向拉取**（runner 侧）
 * （spec ai-gateway-catalog-coldstart，任务 2.3；Req 1.1/1.2/4.3）。
 *
 * ## 时序问题与本模块的位置
 *
 * 装配期宿主的目录快照可能尚未就绪（stale-while-revalidate，首拉完成前恒为空集）。
 * 此时 spawn env 只带该实例的 `BASE`/`KEY`（声明 + 凭据）而不带 `MODELS`，会话侧据此
 * 以**空模型集**先注册占位——这一步必不可少：`option-mapper` 只有在至少一个模型源解析
 * 成功时才构造共享 `ModelRegistry`，registry 不存在则补注册无处落脚。
 *
 * 随后本模块向宿主索取收敛后的清单，拿到即**再注册一次**覆盖。
 *
 * ## ★ 为什么覆盖是安全的
 *
 * `ModelRegistry.registerProvider` 同名重复注册是**覆盖**语义（已实证，见 adapters 的
 * `session-model-source.it.test.ts`），无需先 `unregisterProvider`。
 *
 * ## ★ 为什么会话不需要重建
 *
 * pi SDK 的 `get_available_models` **每次都实时读** `session.modelRegistry.getAvailable()`
 * （`rpc-mode.js:376-378`），不是构造期快照。故补注册后下一次拉清单即可见。
 * 若该 SDK 行为变更，本模块的价值随之消失——见 design.md 的 Revalidation Triggers。
 *
 * ## ★ 本仓首个「runner 发起 + 宿主应答」的关联往返
 *
 * 既有关联往返（`ui_rpc`、attachment catalog）全部是宿主发起、在途表在宿主侧。这里方向
 * 相反，故在途表落在 runner 侧；语义与宿主侧 `PendingRequests` 一致：**未知/迟到 id
 * 安全丢弃**，不抛。
 */
import type { FrameChannel } from "./frame-channel/index.js";
import {
  GATEWAY_MODELS_REQUEST_FRAME_TYPE,
  GatewayModelsResultFrameSchema,
  type GatewayModelsRequestFrame,
  type GatewayModelsResultFrame,
} from "@blksails/pi-web-protocol";

/**
 * 补注册回调:拿到收敛后清单时**整批**调用。
 *
 * ★ 为什么是整批而非逐实例:网关来源的 spec 形态是「一批实例条目」,`registrar.register`
 * 只接受整份 spec(签名里没有 providerName 参数)。逐实例回调会迫使调用方在外部拼装
 * 中间态,反而更易漏 —— 见 `model-sources.ts` 里 ai-gateway 源的 register 实现。
 */
export type GatewayModelsApplier = (
  updates: ReadonlyArray<{ readonly instanceId: string; readonly models: readonly string[] }>,
) => void;

export interface GatewayModelsPending {
  /** 清单待补的实例标识(即其 provider 名)。 */
  readonly instanceIds: readonly string[];
  /** 补注册出口;由 option-mapper 闭包持有共享 registry 后注入。 */
  readonly apply: GatewayModelsApplier;
}

export interface GatewayModelsLogger {
  info(msg: string, data?: Record<string, unknown>): void;
}

/**
 * 模块级持有者。
 *
 * ★ 为什么需要它：待补清单在**会话构造期**（`option-mapper`）才知道，而帧通道在
 * **runner 启动期**安装——两者的就绪顺序不由本模块决定。故两边各自「登记 + 尝试触发」，
 * 谁后到谁负责发起，避免依赖一个实际上没有保证的顺序。
 */
let pending: GatewayModelsPending | undefined;
let channelRef: FrameChannel | undefined;
let requestSent = false;
let seq = 0;

/** 测试接缝:清空模块级状态。 */
export function resetGatewayModelsWiring(): void {
  pending = undefined;
  channelRef = undefined;
  requestSent = false;
  seq = 0;
}

function tryDispatch(logger?: GatewayModelsLogger): void {
  if (requestSent) return;
  if (pending === undefined || channelRef === undefined) return;
  if (pending.instanceIds.length === 0) return;

  requestSent = true;
  seq += 1;
  const frame: GatewayModelsRequestFrame = {
    type: GATEWAY_MODELS_REQUEST_FRAME_TYPE,
    id: `gwm-${seq}`,
    instanceIds: [...pending.instanceIds],
  };
  const expectId = frame.id;
  const applier = pending.apply;

  // 在途表:只认自己刚发出的那个 id。宿主的迟到/未知应答一律丢弃(不抛)。
  channelRef.register(
    "piweb_gateway_models_result",
    GatewayModelsResultFrameSchema,
    (result: GatewayModelsResultFrame) => {
      if (result.id !== expectId) return;
      // 空清单也照常 apply:`ready` + 空数组是「收敛后确实为空」的权威读数,
      // 覆盖成空与保持占位空集等效,但保留了「已问过」这一事实。
      applier(result.instances.map((i) => ({ instanceId: i.instanceId, models: i.models })));
      logger?.info("ai-gateway session models backfilled", {
        reason: result.reason,
        instances: result.instances.map((i) => ({
          instanceId: i.instanceId,
          models: i.models.length,
        })),
      });
    },
  );

  try {
    channelRef.send(frame);
    logger?.info("ai-gateway session models requested", {
      instances: frame.instanceIds.length,
    });
  } catch (err) {
    // 通道不可用不得让会话起不来:放弃本次拉取,保持既有 fail-soft(Req 3.3/5.2)。
    requestSent = false;
    logger?.info("ai-gateway session models request failed", { error: String(err) });
  }
}

/**
 * 登记「有实例的清单待补」及其补注册出口（由 `option-mapper` 在构造共享 registry 后调用）。
 * 帧通道若已就绪则立即发起请求，否则等通道登记时再发。
 */
export function registerGatewayModelsPending(
  input: GatewayModelsPending,
  logger?: GatewayModelsLogger,
): void {
  pending = input;
  tryDispatch(logger);
}

/**
 * 登记帧通道（由 runner 启动期调用）。若待补清单已登记则立即发起请求。
 */
export function attachGatewayModelsChannel(
  channel: FrameChannel,
  logger?: GatewayModelsLogger,
): void {
  channelRef = channel;
  tryDispatch(logger);
}
