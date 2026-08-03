/** 宿主对话流成品图动作；贡献模块只声明行为，视觉、排序与错误态由宿主持有。 */
export interface ConversationImageAsset {
  readonly id: string;
  readonly url: string;
  readonly filename?: string;
  readonly mediaType: string;
  readonly attachmentId?: string;
}

export interface ConversationImageActionContext {
  readonly asset: ConversationImageAsset;
  readonly assets: readonly ConversationImageAsset[];
  publishPaneEvent(topic: string, payload?: unknown): void;
}

export interface ConversationImageAction {
  readonly id: string;
  readonly label: string;
  /** 宿主已装 SVG 图标库中的图标名；未知值回退为通用动作图标。 */
  readonly icon: string;
  readonly order?: number;
  when?(context: ConversationImageActionContext): boolean;
  run(context: ConversationImageActionContext): void | Promise<void>;
}
