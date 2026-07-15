/**
 * resolveSandboxTemplate — 会话创建路径的三级沙箱模板解析与终判错误
 * (spec sandbox-baked-agent-image,任务 2.2;Req 3.1-3.4)。
 *
 * 解析序(design「template-resolve」/ research「Decision: 模板解析序」):
 *  ① 显式映射 `PI_WEB_E2B_TEMPLATE_MAP`(JSON:source 标识 → 模板名):键两级查找,
 *     **先 exact rawSource 串(用户传入的原始 source),再 policySource**(resolver 稳定
 *     标识)——消除「绝对路径 vs 相对 source 串」的键匹配歧义;命中字面模板名 →
 *     `via: "map"`。map 值支持 `derive:<tag>` 形式,该形式**归入派生级**(仅提供 tag,
 *     受同一门控约束),不算 map 命中。
 *  ② 门控派生:仅 `PI_WEB_E2B_TEMPLATE_DERIVE=1` 且能取到 tag 时参与——tag 来源为
 *     map 值 `derive:<tag>` 形式(优先)或 `PI_WEB_E2B_TEMPLATE_DERIVE_TAG`;取到则
 *     `deriveTemplateName(source, tag)` → `via: "derived"`,取不到 tag 跳过此级。
 *  ③ 全局模板 `PI_WEB_E2B_TEMPLATE` → `via: "global"`(既有单模板部署向后兼容)。
 *  ④ 全空 → `ok: false`,错误文案携三种修复路径与当前 policySource(Req 3.4,
 *     不静默回退本地执行)。
 *
 * 本模块直接读取的 env 变量(经传入的 env 快照,不读全局 process.env):
 *  - `PI_WEB_E2B_TEMPLATE_DERIVE_TAG`(可选):派生级的默认 tag(map 值非 derive 形式
 *    或未命中时的 tag 来源);仅在 `PI_WEB_E2B_TEMPLATE_DERIVE=1` 时有意义。
 *  其余模板配置面(TEMPLATE / TEMPLATE_MAP / TEMPLATE_DERIVE)经 `e2bTransportConfigFromEnv`
 *  统一解析(复用任务 2.1 的产物,避免双解析漂移),登记见 `e2b-config.ts` 文件头。
 *
 * 前置条件:env 快照须能通过 e2b 配置解析(即 `E2B_API_KEY` 已存在)——本函数只在
 * `selectTransport` 判定 e2b 分支后的会话创建路径被调;缺 API key / TEMPLATE_MAP 非法
 * 时传播 e2b-config 的既有清晰错误(fail-fast,不吞)。
 *
 * 纯函数:同输入恒同输出;不读全局 process.env / fs。
 */
import { e2bTransportConfigFromEnv } from "./e2b-config.js";
import {
  deriveTemplateName,
  type SourceIdentityInput,
} from "../sandbox-image/template-name.js";

/**
 * 模板解析的 source 输入 —— 对 design 签名 `SourceIdentityInput` 的最小充实:
 * map 键两级查找需要「用户传入的原始 source 串」与「resolver 稳定 policySource」
 * 两个键位,而 `SourceIdentityInput` 只有 policySource,故扩展可缺省的 `rawSource`
 * (缺省时仅按 policySource 查找;派生级仍只消费 policySource,保证与构建期命名一致)。
 */
export interface TemplateResolveSource extends SourceIdentityInput {
  /** 用户传入的原始 source 串(如相对路径 / 未归一 git url);map 键第一优先位。 */
  readonly rawSource?: string;
}

/** resolveSandboxTemplate 输入(design「template-resolve」Service Interface)。 */
export interface TemplateResolveInput {
  readonly source: TemplateResolveSource;
  readonly env: Record<string, string | undefined>;
}

/**
 * 模板解析结果:成功携 `via` 标记(map/derived/global)供日志排查解析级别;
 * 失败携修复指引文案(调用方在会话创建路径抛出即可,Req 3.4)。
 */
export type TemplateResolution =
  | {
      readonly ok: true;
      readonly template: string;
      readonly via: "map" | "derived" | "global";
    }
  | { readonly ok: false; readonly error: string };

/** map 值的派生形式前缀(`derive:<tag>`,归入派生级)。 */
const DERIVE_VALUE_PREFIX = "derive:";

/**
 * 三级全空时的错误文案(Req 3.4):含当前 source 的 policySource 便于定位,
 * 与三种修复路径。集中一处便于测试断言与文案维护(风格对齐
 * `E2B_CONFIG_MISSING_MESSAGE`)。
 */
export function templateResolveMissingMessage(policySource: string): string {
  return (
    `无法为 source "${policySource}" 解析沙箱模板(显式映射 → 派生约定 → 全局模板均未命中)。` +
    `修复路径任选其一:` +
    `1) 配置 PI_WEB_E2B_TEMPLATE_MAP(JSON,形如 {"${policySource}":"<模板名>"});` +
    `2) 设 PI_WEB_E2B_TEMPLATE_DERIVE=1 启用派生约定并提供 tag(map 值 "derive:<tag>" 或 ` +
    `PI_WEB_E2B_TEMPLATE_DERIVE_TAG),且在 agent-sandbox 注册对应 dynamic 模板规则;` +
    `3) 设 PI_WEB_E2B_TEMPLATE 指定全局模板。`
  );
}

/**
 * 按「显式映射 → 门控派生 → 全局模板 → 清晰错误」解析当前 source 的沙箱模板
 * (Req 3.1-3.4)。local 模式不经过本函数(Req 3.5 零变化)。
 */
export function resolveSandboxTemplate(
  input: TemplateResolveInput,
): TemplateResolution {
  const { source, env } = input;
  // 复用 2.1 的解析产物(templateMap/templateDerive/template),不重写 JSON 解析逻辑;
  // 缺 API key / MAP 非法时传播其既有清晰错误。
  const config = e2bTransportConfigFromEnv(env);

  // ① 显式映射:先 exact rawSource 串,再 policySource。
  const mapValue = lookupMap(config.templateMap, source);
  const deriveForm = mapValue !== undefined ? parseDeriveForm(mapValue) : undefined;
  if (mapValue !== undefined && deriveForm === undefined) {
    return { ok: true, template: mapValue, via: "map" };
  }

  // ② 门控派生:仅门控开启且能取到 tag(map derive:<tag> 优先,回落 DERIVE_TAG)。
  if (config.templateDerive) {
    const tag = deriveForm?.tag ?? trimmed(env.PI_WEB_E2B_TEMPLATE_DERIVE_TAG);
    if (tag !== undefined) {
      return {
        ok: true,
        template: deriveTemplateName(source, tag),
        via: "derived",
      };
    }
  }

  // ③ 全局模板(既有单模板部署向后兼容)。
  if (config.template !== undefined) {
    return { ok: true, template: config.template, via: "global" };
  }

  // ④ 全空 → 携三种修复路径的清晰错误(调用方抛出使会话创建失败,不静默回退)。
  return { ok: false, error: templateResolveMissingMessage(source.policySource) };
}

/** map 键两级查找:先 exact rawSource 串,再 policySource;均未命中 → undefined。 */
function lookupMap(
  map: Readonly<Record<string, string>> | undefined,
  source: TemplateResolveSource,
): string | undefined {
  if (map === undefined) return undefined;
  if (source.rawSource !== undefined) {
    const byRaw = map[source.rawSource];
    if (byRaw !== undefined) return byRaw;
  }
  return map[source.policySource];
}

/**
 * 识别 map 值的 `derive:<tag>` 形式:命中返回 `{ tag }`(tag 纯空白视为缺省 →
 * `tag: undefined`,派生级回落 DERIVE_TAG);非该形式返回 undefined(字面模板名)。
 */
function parseDeriveForm(
  value: string,
): { readonly tag: string | undefined } | undefined {
  if (!value.startsWith(DERIVE_VALUE_PREFIX)) return undefined;
  return { tag: trimmed(value.slice(DERIVE_VALUE_PREFIX.length)) };
}

/** 非空 trim(与 e2b-config 同语义):undefined/纯空白 → undefined。 */
function trimmed(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  return v.length > 0 ? v : undefined;
}
