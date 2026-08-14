/**
 * 出图尺寸档位。与 pi-labs `src/agents/aigc/shared/options.ts` 对齐,
 * 并保留本仓 gpt 系常用档与 `auto`。
 *
 * 单一事实源:工具追问 / 清单下发 / canvas 模型尺寸族均读此表。
 */
export const SIZE_OPTIONS: readonly string[] = [
  "1024x1024",
  "1280x720",
  "720x1280",
  "1328x1328",
  "832x1216",
  "800x800",
  "1080x1920",
  "1536x1024",
  "1024x1536",
  "custom",
  "auto",
];

/** dashscope / wan / qwen 族:pi-labs 全量像素档。 */
export const DASHSCOPE_SIZE_OPTIONS: readonly string[] = [
  "1024x1024",
  "1280x720",
  "720x1280",
  "1328x1328",
  "832x1216",
  "800x800",
  "1080x1920",
];

/** gpt / gemini 系常见档(网关枚举)。 */
export const DEFAULT_SIZE_OPTIONS: readonly string[] = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
];
