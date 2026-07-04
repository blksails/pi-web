/**
 * useConversationBridge — 对话桥应用面唯一门面(契约 §4.5 / C3-*)。
 *
 * 把宿主对话桥的三个裸注入项(会话提交能力 `conversation` / 过渡别名 `onSubmitPrompt`、
 * 轮末信号 `syncSignal`、控制面访问 `surface`)收口为单一 hook,应用面据此获得四能力:
 *  - **opChannel**:C3-4 降级次序的探测结果(prompt / command / unavailable),渲染时同步求值,
 *    供 UI 可感知地呈现降级态;门面不暴露任何通道指定手段(2.8)。
 *  - **submitOp(op)**:按 opChannel 分道提交操作 —— prompt 态经 `renderSurfaceOp` 渲染为用户消息
 *    走 Prompt 通道(C3-1);command 态经 `op.fallback` 降级 `surface.run`(LLM 不在环);
 *    通道缺失一律以 {@link SubmitOpResult} 承载失败,不抛异常(1.4 / 2.6 / 2.7)。
 *  - **bringToConversation(refs, summary?)**:ContextInjection 注入门面(C3-2),经 Prompt 通道把
 *    制品引用与摘要带入对话;非 prompt 态返回 ok:false(4.3,注入本质依赖对话通道,无降级)。
 *    注意别名 onSubmitPrompt 不承载 attachmentIds,故 alias-only(无 conversation)时亦返回 ok:false。
 *  - **onTurnEnd(cb)**:TurnSync 订阅门面(C3-3),封装 `syncSignal` 边沿;返回退订函数。
 *
 * 装配范式对齐 {@link useSurface}:host 注入 props → 应用面一次性递入 opts → hook 装配为桥
 * (契约 §4.2:应用面永不自造通道,SDK 居中装配)。类型与纯函数落 web-kit(canonical 家)。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { surfaceStateKey } from "@blksails/pi-web-protocol";
import {
  renderSurfaceOp,
  type SurfaceOp,
  type SubmitOpResult,
  type ConversationAccess,
  type WebExtSurfaceAccess,
} from "@blksails/pi-web-kit";

/**
 * `bringToConversation` 未提供摘要时的默认文本基串(4.2:可识别的默认文本)。
 * 运行时以其为前缀并附 refs 数量,构成完整消息;导出供单测锚定。
 */
export const DEFAULT_BRING_TEXT = "带入对话";

/** 组装 `bringToConversation` 默认消息文本:基串 + 制品数量(4.2)。 */
function composeBringText(summary: string | undefined, refCount: number): string {
  if (summary !== undefined && summary !== "") return summary;
  return `${DEFAULT_BRING_TEXT}(共 ${refCount} 项制品)`;
}

export interface UseConversationBridgeOptions {
  /** 宿主会话能力(优先;契约 §4.2 能力对象形态)。 */
  readonly conversation?: ConversationAccess;
  /** 过渡别名(conversation 缺席时兜底;二者都在时 conversation 优先;deprecated)。 */
  readonly onSubmitPrompt?: (text: string) => void;
  /** 控制面访问(command 态探测与降级执行)。 */
  readonly surface?: WebExtSurfaceAccess;
  /** 轮末信号(TurnSync;值变化即一轮结束)。 */
  readonly syncSignal?: unknown;
  /** 应用面 domain(command 态探针 `surface:<domain>`;缺席则跳过 command 层)。 */
  readonly domain?: string;
}

export interface ConversationBridge {
  /** C3-4 降级次序的探测结果(UI 据此呈现降级态)。 */
  readonly opChannel: "prompt" | "command" | "unavailable";
  /** 按 opChannel 分道提交操作;不提供通道指定参数(2.8)。 */
  submitOp(op: SurfaceOp): Promise<SubmitOpResult>;
  /** C3-2 注入门面:refs + 摘要经 Prompt 通道进对话;非 prompt 态(含 alias-only 无 conversation)返回 ok:false。 */
  bringToConversation(refs: readonly string[], summary?: string): SubmitOpResult;
  /** C3-3 订阅门面:轮末回调;返回退订函数。 */
  onTurnEnd(cb: () => void): () => void;
}

/** 无通道可用时的失败结果构造(2.7 / 4.3;不静默、不抛异常)。 */
function unavailableResult(message: string): SubmitOpResult {
  return { ok: false, error: { code: "unavailable", message } };
}

export function useConversationBridge(
  opts: UseConversationBridgeOptions,
): ConversationBridge {
  const { conversation, onSubmitPrompt, surface, syncSignal, domain } = opts;

  // C3-4 探测:渲染时同步求值,严格按次序(prompt → command → unavailable)。
  // hasCommand 为渲染时快照求值(与 canvas 现状同);fallback 缺失不影响 opChannel 本身。
  let opChannel: ConversationBridge["opChannel"];
  if (conversation !== undefined || onSubmitPrompt !== undefined) {
    opChannel = "prompt";
  } else if (
    surface !== undefined &&
    domain !== undefined &&
    surface.hasCommand(surfaceStateKey(domain))
  ) {
    opChannel = "command";
  } else {
    opChannel = "unavailable";
  }

  // Prompt 通道统一提交口:conversation 优先、别名兜底(6.2)。仅供 submitOp 的纯文本操作
  // 提交使用;别名不承载 attachmentIds,故 bringToConversation 不走此口(严格要求 conversation)。
  const submitViaPrompt = useCallback(
    (text: string, attachmentIds?: readonly string[]): boolean => {
      if (conversation !== undefined) {
        conversation.submitUserMessage(
          text,
          attachmentIds !== undefined ? { attachmentIds } : undefined,
        );
        return true;
      }
      if (onSubmitPrompt !== undefined) {
        onSubmitPrompt(text);
        return true;
      }
      return false;
    },
    [conversation, onSubmitPrompt],
  );

  const submitOp = useCallback(
    async (op: SurfaceOp): Promise<SubmitOpResult> => {
      // prompt 态:渲染为结构化用户消息经 Prompt 通道提交(2.4 / C3-1)。
      if (conversation !== undefined || onSubmitPrompt !== undefined) {
        submitViaPrompt(renderSurfaceOp(op));
        return { ok: true, channel: "prompt" };
      }
      // command 态:有 fallback 走控制面降级(2.5),无 fallback 可观察失败(2.6)。
      if (
        surface !== undefined &&
        domain !== undefined &&
        surface.hasCommand(surfaceStateKey(domain))
      ) {
        if (op.fallback === undefined) {
          return {
            ok: false,
            error: {
              code: "no_fallback",
              message: `surface op "${op.tool}" has no control-plane fallback in command channel`,
            },
          };
        }
        const result = await surface.run(domain, op.fallback.action, op.fallback.args);
        return { ok: true, channel: "command", result };
      }
      // unavailable 态:无任何可用通道(2.7)。
      return unavailableResult("conversation bridge has no available op channel");
    },
    [conversation, onSubmitPrompt, surface, domain, submitViaPrompt],
  );

  const bringToConversation = useCallback(
    (refs: readonly string[], summary?: string): SubmitOpResult => {
      // C3-2:注入本质=复用宿主附件引用注入机制(ConversationAccess.submitUserMessage 的
      // attachmentIds)。别名 onSubmitPrompt 只承载 text、不承载 attachmentIds,故此门面
      // 严格要求 conversation 能力在场——alias-only 不能静默丢弃 refs(4.1 / 4.3;失败须可观察)。
      if (conversation === undefined) {
        return unavailableResult(
          "attachment reference injection requires the conversation capability (alias channel cannot carry attachmentIds)",
        );
      }
      const text = composeBringText(summary, refs.length);
      conversation.submitUserMessage(text, { attachmentIds: refs });
      return { ok: true, channel: "prompt" };
    },
    [conversation],
  );

  // C3-3 轮末订阅:listener 集合常驻 ref;syncSignal 记首见值,仅变化触发(5.1),
  // 退订后不再触发(5.2),syncSignal 缺席则注册成功永不触发(5.3),StrictMode 幂等。
  const listenersRef = useRef<Set<() => void>>(new Set());
  const lastSyncRef = useRef<{ seen: boolean; value: unknown }>({
    seen: false,
    value: undefined,
  });
  useEffect(() => {
    const prev = lastSyncRef.current;
    if (!prev.seen) {
      // 首见:记录不触发(初值不是一次轮末)。
      lastSyncRef.current = { seen: true, value: syncSignal };
      return;
    }
    // Object.is 守卫:值未变化(含 StrictMode 重跑同值)不触发。
    if (Object.is(prev.value, syncSignal)) return;
    lastSyncRef.current = { seen: true, value: syncSignal };
    for (const cb of listenersRef.current) cb();
  }, [syncSignal]);

  const onTurnEnd = useCallback((cb: () => void): (() => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  return useMemo<ConversationBridge>(
    () => ({ opChannel, submitOp, bringToConversation, onTurnEnd }),
    [opChannel, submitOp, bringToConversation, onTurnEnd],
  );
}
