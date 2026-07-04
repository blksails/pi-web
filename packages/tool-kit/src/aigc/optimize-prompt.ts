/**
 * optimize-prompt — AIGC 图像工具的「提示词优化」接缝(aigc-tool-settings)。
 *
 * 本期(aigc-tool-settings)**只做开关 + 读取接缝**:当会话状态 `aigc.enablePromptOptimization`
 * 为真时,`run-image-tool` 在派发 provider 前调用本接缝。真正的 LLM 二次改写留后续 spec,
 * 故当前实现为**无改写透传**(返回值恒等于入参 prompt,Req 4.4)。
 *
 * 后续替换点:在此实现「选改写模型 → 二次改写 → 失败兜底 → 不翻译用户原语」等逻辑,
 * 保持签名不变即可,run-image-tool 无需改动。
 */
export interface OptimizePromptOptions {
  /** 取消信号(后续实现真实改写时用于中断上游调用)。 */
  readonly signal?: AbortSignal;
}

/**
 * 提示词优化接缝。**本期为无改写透传占位**:返回值严格等于入参 `prompt`。
 */
export async function optimizePrompt(
  prompt: string,
  _opts?: OptimizePromptOptions,
): Promise<string> {
  // 占位:不改写、不调用任何 LLM。后续 spec 在此实现真正的二次改写。
  return prompt;
}
