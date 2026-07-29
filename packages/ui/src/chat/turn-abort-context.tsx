/**
 * TurnAbort — 「终止本轮」能力的下发通道(spec aigc-tool-abort,UI 扩展)。
 *
 * 工具卡(`PiToolPart`)需要在 Running 态提供一个就地的停止入口 —— 用户视线在卡片上,
 * 让他跑去输入框找停止按钮是多余的一跳,尤其图像生成常耗时 20~60s。
 *
 * 但 `PiToolPart` 是**纯展示组件**,拿不到 `controls`;而它与 `PiChat` 之间隔着
 * `PartRenderer`,逐层透传会污染中间层签名(PartRenderer 的 props 已经很多)。故照
 * `path-display-context` 的既有模式走 React context 注入,中间层零改动。
 *
 * ★ **语义必须说清楚**:协议层只有会话级的 `POST /sessions/:id/abort`,**没有**单工具
 * 取消端点。所以卡片上的停止 = **终止本轮**(当前这次 assistant 回合),而不是"只停这个
 * 工具、让模型继续"。单工具在跑时两者等价;多工具并行时有差异 —— 故按钮的 aria-label /
 * title 必须写"终止本轮"而非"停止此工具",避免用户预期落空。
 *
 * 缺省值为 `undefined`(无能力):未包 Provider 的场景(如 Storybook、独立渲染工具卡)
 * 不显示停止按钮,行为与引入本 context 之前逐字节一致。
 */
import * as React from "react";

/** 终止本轮的能力句柄;`undefined` = 当前不可终止(未在运行 / 宿主未提供)。 */
export type TurnAbortHandle = (() => void) | undefined;

const TurnAbortContext = React.createContext<TurnAbortHandle>(undefined);

export interface TurnAbortProviderProps {
  /**
   * 终止回调。宿主在**本轮正在运行时**传入;不在运行时传 `undefined`,
   * 工具卡据此隐藏停止按钮(而不是渲染一个点了没反应的按钮)。
   */
  readonly onAbortTurn?: TurnAbortHandle;
  readonly children: React.ReactNode;
}

/** 向下注入「终止本轮」能力。 */
export function TurnAbortProvider({
  onAbortTurn,
  children,
}: TurnAbortProviderProps): React.JSX.Element {
  return (
    <TurnAbortContext.Provider value={onAbortTurn}>{children}</TurnAbortContext.Provider>
  );
}

/**
 * 读取「终止本轮」能力。返回 `undefined` 表示当前不可终止,调用方应**不渲染**停止入口。
 */
export function useTurnAbort(): TurnAbortHandle {
  return React.useContext(TurnAbortContext);
}
