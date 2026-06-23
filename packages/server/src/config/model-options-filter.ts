/**
 * model-options-filter — 模型选项的 provider 排除过滤(纯函数,无 pi SDK 依赖)。
 *
 * 供 handler 装配层(lib/app/pi-handler)按部署期开关从 `/config/models` 数据中剔除
 * 指定 provider 的模型(例如隐藏某个不想暴露给用户的 provider)。刻意与 `model-options`
 * (引 pi SDK 的取数)分离,使本过滤逻辑可被单测直接覆盖而不加载 pi SDK。
 *
 * 开关来源:环境变量 `PI_WEB_HIDE_PROVIDERS`(逗号分隔的 provider 名,如
 * `anthropic,openai`)。匹配按 provider 原名精确比较(大小写敏感),与 ModelRegistry
 * 报出的 `provider` 字段同形。
 */
import type { ModelOptions } from "./model-options.types.js";

/**
 * 解析逗号分隔的 provider 排除名单为集合;忽略空白与空项。
 * `undefined`/空串/全空白 → 空集合(不过滤)。
 */
export function parseHiddenProviders(
  raw: string | undefined,
): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * 从模型选项中剔除 `hidden` 中列出的 provider:同时过滤 `models`(按 `m.provider`)
 * 与去重后的 `providers` 名单。`hidden` 为空 → 原样返回(零拷贝快路径)。纯函数,不改入参。
 */
export function excludeProviders(
  options: ModelOptions,
  hidden: ReadonlySet<string>,
): ModelOptions {
  if (hidden.size === 0) return options;
  return {
    providers: options.providers.filter((p) => !hidden.has(p)),
    models: options.models.filter((m) => !hidden.has(m.provider)),
  };
}
