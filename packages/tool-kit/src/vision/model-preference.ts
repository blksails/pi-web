/**
 * 视觉模型偏好的读写 —— config 域 `aigc` 的 `visionModel` 字段。
 *
 * ## 为什么落 config 文件而不是会话 KV
 *
 * 图像工具的参数偏好(`aigc.model`/`aigc.size`)写的是**会话 KV**,换个会话就重来 ——
 * 那符合「这一轮我想用这个尺寸」的语义。视觉模型不同:它回答的是「用哪个模型看图」,
 * 属于**长期取向**。写会话 KV 的话每开一个新会话都要重新弹层,等于没解决问题。
 *
 * ## 读:config > env > 无(弹层询问)
 *
 * env `PI_WEB_VISION_MODEL` 保留且**不能删**:无人值守通道(IM / 定时任务)没有人点弹层,
 * 只能靠预置;现有部署也可能已在用。config 优先是因为它是用户在本机的显式选择。
 *
 * ## 写:弹层选过即静默记住
 *
 * 与 `run-image-tool` 的 `resolveRequiredParams` 静默写回会话偏好同范式。弹层本身就是
 * 「你现在要选一个」,记住它是合理预期;选错不是死局 —— /settings 的「视觉模型」可改可清空。
 *
 * ## 每次调用现读,不缓存
 *
 * 装配期读一次会让写回**要到下次会话才生效**,那正是这个特性要消除的体验。视觉调用本身
 * 就带一次网络往返,一次同步小文件读可忽略。
 */
import fs from "node:fs";
import path from "node:path";
import { AIGC_TOOL_SETTINGS_FILE, resolveAgentDir } from "../aigc/model-config.js";

/** config 域 `aigc` 里存视觉模型的字段名(与 protocol schema 一致)。 */
export const VISION_MODEL_FIELD = "visionModel";

function settingsPath(agentDir?: string): string {
  return path.join(agentDir ?? resolveAgentDir(), AIGC_TOOL_SETTINGS_FILE);
}

/** 读整份设置对象;缺失 / 坏 JSON → 空对象(fail-soft,与 model-config 同语义)。 */
function readRaw(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 读已配置的视觉模型。空串 / 非字符串 / 文件不可读 → `undefined`(= 未配置,交由上层弹层)。
 */
export function readVisionModelPreference(agentDir?: string): string | undefined {
  const value = readRaw(settingsPath(agentDir))[VISION_MODEL_FIELD];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 写回视觉模型偏好。
 *
 * ★ 必须 read-modify-write:schema 是 `.passthrough()`,且 /settings 会往同一文件写
 * `disabledModels` / `enablePromptOptimization`。整份覆盖会把用户的其它设置抹掉。
 *
 * 任何失败(目录不可写、盘满、并发写)一律**静默吞掉**:写回是锦上添花,失败的后果只是
 * 「下次还会问」,绝不能让一次解读因为写不了配置而失败。
 */
export function writeVisionModelPreference(model: string, agentDir?: string): void {
  if (model === "") return;
  const file = settingsPath(agentDir);
  try {
    const current = readRaw(file);
    if (current[VISION_MODEL_FIELD] === model) return; // 无变化不写盘
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...current, [VISION_MODEL_FIELD]: model }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // 见上:写不进去只影响「下次还问」,不影响本次解读。
  }
}

/**
 * 组装 `defaultModel` 取值器:config > env。
 *
 * 返回 thunk 而非值 —— 每次调用现读,使写回**立即生效**(见文件头「不缓存」)。
 */
export function visionModelResolver(envVar: string, agentDir?: string): () => string | undefined {
  return () => {
    const configured = readVisionModelPreference(agentDir);
    if (configured !== undefined) return configured;
    const raw = process.env[envVar];
    return raw !== undefined && raw.length > 0 ? raw : undefined;
  };
}
