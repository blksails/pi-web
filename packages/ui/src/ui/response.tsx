/**
 * Response — AI Elements 等价的 Markdown 渲染原语(经 streamdown 安全渲染流式 Markdown)。
 *
 * 替代 AI Elements `<Response>`:streamdown 同样是其底座,直接装配以避免网络拉取 registry。
 *
 * **放行 data: 图片(AIGC 流式渐进图)**:streamdown 底层管线 `rehype-sanitize`(默认 schema)会剥掉
 * `data:` 的 `<img src>`(默认 `protocols.src=["http","https"]`),`rehype-harden` 再把无 src 的图渲染成
 * "[Image blocked: …]"。AIGC 的 partial_images 渐进图与早弹预览以 **data URI 内联**呈现,故这里:
 *   1. 扩展 sanitize schema —— 给 `protocols.src` 加 `"data"`(仅放行 img 的 data: 源,其余 XSS 防护不变);
 *   2. harden `allowDataImages:true`(默认已为真,显式保底)。
 * 内容源为本工具管线,可信;http/https 图与 LLM 文本的既有 sanitize 防护均保留。
 */
import * as React from "react";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "../lib/cn.js";

type RehypePlugins = NonNullable<
  React.ComponentProps<typeof Streamdown>["rehypePlugins"]
>;

// 默认 schema + 放行 img 的 data: 源(其余原样保留)。
const IMAGE_DATA_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? ["http", "https"]), "data"],
  },
};

// 复用 streamdown 默认 rehypePlugins,替换 sanitize(扩展 schema)、覆盖 harden(允许 data:image/)。
const REHYPE_PLUGINS = Object.entries(defaultRehypePlugins).map(
  ([key, value]) => {
    if (key === "sanitize") return [rehypeSanitize, IMAGE_DATA_SCHEMA];
    if (key === "harden") {
      const fn = Array.isArray(value) ? value[0] : value;
      const opts = (Array.isArray(value) ? value[1] : {}) as Record<string, unknown>;
      return [fn, { ...opts, allowDataImages: true }];
    }
    return value;
  },
) as unknown as RehypePlugins;

export interface ResponseProps {
  readonly children: string;
  readonly className?: string;
}

export const Response = React.memo(function Response({
  children,
  className,
}: ResponseProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none text-[hsl(var(--foreground))]",
        className,
      )}
      data-pi-response
    >
      <Streamdown rehypePlugins={REHYPE_PLUGINS}>{children}</Streamdown>
    </div>
  );
});
