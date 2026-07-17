/**
 * AskUserQuestion codec — 单一权威。
 *
 * 背景:本特性零协议帧改动,能力经「约定式富载荷」搭载在既有
 * `extension_ui_request(select)` / `extension_ui_response(value)` 帧上——
 * 工具端把问题组编码进 `select` 请求的 `title`,前端识别哨兵后渲染富卡片,
 * 作答经 `value` 字段回传。本文件是问题组/答案的类型、zod 校验 schema、
 * 哨兵常量、编解码函数的唯一来源,工具端与前端均须 import 本文件,
 * 禁止各自硬编码哨兵或结构(见 design.md「Contract (protocol) > AskUserQuestion Codec」)。
 *
 * 纯函数、isomorphic、zero runtime-dep(除 zod,protocol 既有)。
 */
import { z } from "zod";

/** 单个选项:短标签 + 含义/代价说明 */
export const AskOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});
export type AskOption = z.infer<typeof AskOptionSchema>;

/** 单道问题:短 header + 完整 question + 单/多选 + 2–4 个选项 + 可选 Other 自由输入 */
export const AskQuestionSchema = z.object({
  header: z.string().min(1),
  question: z.string().min(1),
  multiSelect: z.boolean(),
  options: z.array(AskOptionSchema).min(2).max(4),
  allowOther: z.boolean().optional(),
});
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

/** 问题组:1–4 道问题 */
export const AskQuestionGroupSchema = z.object({
  questions: z.array(AskQuestionSchema).min(1).max(4),
});
export type AskQuestionGroup = z.infer<typeof AskQuestionGroupSchema>;

/** 单道问题的作答:选中的 option.label 集合(多选可 0..n,单选恰 1)+ 可选 Other 自由文本 */
export const AskAnswerSchema = z.object({
  header: z.string().min(1),
  question: z.string().min(1),
  selected: z.array(z.string()),
  other: z.string().optional(),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

/** 问题组的整体作答 */
export const AskAnswersSchema = z.object({
  answers: z.array(AskAnswerSchema),
});
export type AskAnswers = z.infer<typeof AskAnswersSchema>;

/** 解码应答的判别式结果:富答案(新前端)/ 降级(旧前端裸选项,无答案哨兵) */
export type AskDecodeResult =
  | { readonly kind: "rich"; readonly answers: AskAnswers }
  | { readonly kind: "degraded"; readonly rawValue: string };

/**
 * title 侧哨兵:标记 `select` 请求的 title 携带富问题组 JSON 载荷。
 * 唯一来源——工具端与前端均须 import 本常量,禁止硬编码字面量。
 */
export const ASK_TITLE_SENTINEL = "PIAQ:v1:";

/**
 * answer 侧哨兵:标记 `extension_ui_response` 的 value 携带富答案 JSON 载荷。
 * 唯一来源——工具端与前端均须 import 本常量,禁止硬编码字面量。
 */
export const ASK_ANSWER_SENTINEL = "PIAQA:v1:";

/**
 * 校验并编码问题组为 `ctx.ui.select` 请求载荷。
 * title = 人类可读前导(供旧前端可读) + 哨兵 + JSON(供新前端解析);
 * options = 降级兜底选项,取首题各 option 的 label(保证旧前端 select 可读可选)。
 *
 * @throws 入参未通过 {@link AskQuestionGroupSchema} 时抛出(供工具端 catch 转错误结果)。
 */
export function encodeAskRequest(
  group: AskQuestionGroup,
): { readonly title: string; readonly options: string[] } {
  const parsed = AskQuestionGroupSchema.parse(group);
  // schema 保证 questions 至少 1 项,故此处非空断言安全
  const firstQuestion = parsed.questions[0]!;
  const humanPrefix =
    parsed.questions.length === 1
      ? firstQuestion.question
      : `${firstQuestion.question} (+${parsed.questions.length - 1} more)`;
  const title = `${humanPrefix}${ASK_TITLE_SENTINEL}${JSON.stringify(parsed)}`;
  const options = firstQuestion.options.map((option) => option.label);
  return { title, options };
}

/** 前端:title 是否携带富问题组哨兵 */
export function isAskTitle(title: string): boolean {
  return title.includes(ASK_TITLE_SENTINEL);
}

/**
 * 前端:从 title 解出问题组。
 * 非富载荷或解析/校验失败均返回 `undefined`,绝不抛(供前端优雅回落原生 select 渲染)。
 */
export function decodeAskTitle(title: string): AskQuestionGroup | undefined {
  const sentinelIndex = title.indexOf(ASK_TITLE_SENTINEL);
  if (sentinelIndex === -1) {
    return undefined;
  }
  const jsonPart = title.slice(sentinelIndex + ASK_TITLE_SENTINEL.length);
  try {
    const raw: unknown = JSON.parse(jsonPart);
    const result = AskQuestionGroupSchema.safeParse(raw);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** 前端:编码富答案为应答 value 字符串(含答案哨兵) */
export function encodeAskAnswers(answers: AskAnswers): string {
  return `${ASK_ANSWER_SENTINEL}${JSON.stringify(answers)}`;
}

/**
 * 工具端:解码应答 value。
 * 含答案哨兵且解析/校验通过 → `{kind:"rich"}`;
 * 不含哨兵,或含哨兵但解析/校验失败 → `{kind:"degraded"}`(旧前端裸选项 / 损坏载荷兜底)。
 *
 * `group` 参数保留供调用方按问题组语境做后续处理(当前解码本身不依赖它)。
 */
export function decodeAskAnswers(
  value: string,
  _group: AskQuestionGroup,
): AskDecodeResult {
  if (!value.startsWith(ASK_ANSWER_SENTINEL)) {
    return { kind: "degraded", rawValue: value };
  }
  const jsonPart = value.slice(ASK_ANSWER_SENTINEL.length);
  try {
    const raw: unknown = JSON.parse(jsonPart);
    const result = AskAnswersSchema.safeParse(raw);
    if (result.success) {
      return { kind: "rich", answers: result.data };
    }
    return { kind: "degraded", rawValue: value };
  } catch {
    return { kind: "degraded", rawValue: value };
  }
}
