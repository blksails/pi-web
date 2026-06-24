/**
 * SandboxRenderer — server-driven UI 的「沙箱组件」解释器(信任模型路径 2)。
 *
 * 把 agent 提供的**声明式节点树**(UiNode,已由协议层 schema 收口)解释为 React。
 * 不是 iframe,也不是 JSX/模板求值,而是一个**白名单元素解释器** —— 这是它的安全本质:
 *
 *   1. 只渲染固定 el 白名单,未知元素返回 null(协议层已拒绝,这里是纵深防御);
 *   2. 全部文本走 React 文本节点(自动转义),绝不 dangerouslySetInnerHTML;
 *   3. 不绑定任何事件处理器 —— 沙箱 UI 是只读展示,无交互逃逸面;
 *   4. 样式只来自令牌映射(ui-tokens),agent 无法注入任意 className/CSS;
 *   5. link.href 渲染前二次校验协议(http/https/mailto),外链强制 rel=noopener;
 *   6. 递归深度上限(MAX_DEPTH)防止深层嵌套撑爆渲染。
 *
 * 由此:沙箱组件能表达任意布局/数据展示,却无法执行代码、发起网络、改写 DOM 或越权。
 */
import * as React from "react";
import type { UiNode } from "@blksails/protocol";
import { cn } from "../lib/cn.js";
import { boxStyleClasses, textStyleClasses, toneSoft } from "./ui-tokens.js";

/** 节点树最大深度;超出即截断(防御深层嵌套 DoS)。 */
const MAX_DEPTH = 12;

/** href 渲染前二次校验(与协议层一致),不通过则降级为纯文本。 */
function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/** image src 渲染前二次校验(与协议层一致),不通过则不渲染 <img>。 */
function isSafeImageSrc(src: string): boolean {
  return /^(https?:|data:image\/)/i.test(src);
}

function renderNode(node: UiNode, key: React.Key, depth: number): React.ReactNode {
  if (depth > MAX_DEPTH) return null;

  switch (node.el) {
    case "box": {
      const isRow = node.direction === "row";
      return (
        <div
          key={key}
          className={cn(
            "flex",
            isRow ? "flex-row flex-wrap" : "flex-col",
            boxStyleClasses(node.style),
          )}
          data-pi-ui-el="box"
        >
          {(node.children ?? []).map((child, i) =>
            renderNode(child, i, depth + 1),
          )}
        </div>
      );
    }

    case "text":
      return (
        <span
          key={key}
          className={cn(textStyleClasses(node.style))}
          data-pi-ui-el="text"
        >
          {node.text}
        </span>
      );

    case "heading": {
      const level = node.level ?? 2;
      const sizeClass =
        level === 1 ? "text-xl" : level === 2 ? "text-lg" : "text-base";
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      return (
        <Tag
          key={key}
          className={cn(
            "font-semibold text-[hsl(var(--foreground))]",
            sizeClass,
            textStyleClasses(node.style),
          )}
          data-pi-ui-el="heading"
        >
          {node.text}
        </Tag>
      );
    }

    case "badge":
      return (
        <span
          key={key}
          className={cn(
            "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
            toneSoft(node.style?.tone),
          )}
          data-pi-ui-el="badge"
        >
          {node.text}
        </span>
      );

    case "divider":
      return (
        <hr
          key={key}
          className="border-[hsl(var(--border))]"
          data-pi-ui-el="divider"
        />
      );

    case "code":
      return node.block === true ? (
        <pre
          key={key}
          className="overflow-x-auto rounded-[var(--radius)] bg-[hsl(var(--muted))] p-2 text-xs"
          data-pi-ui-el="code"
          data-lang={node.lang}
        >
          <code>{node.text}</code>
        </pre>
      ) : (
        <code
          key={key}
          className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-xs"
          data-pi-ui-el="code"
        >
          {node.text}
        </code>
      );

    case "link":
      return isSafeHref(node.href) ? (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[hsl(var(--primary))] underline underline-offset-2"
          data-pi-ui-el="link"
        >
          {node.text}
        </a>
      ) : (
        // 协议外 href:降级为纯文本,绝不渲染可点击链接。
        <span key={key} data-pi-ui-el="link">
          {node.text}
        </span>
      );

    case "list": {
      const Tag = node.ordered === true ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={cn(
            "ml-5 space-y-1 text-sm",
            node.ordered === true ? "list-decimal" : "list-disc",
          )}
          data-pi-ui-el="list"
        >
          {node.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </Tag>
      );
    }

    case "keyValue":
      return (
        <dl
          key={key}
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
          data-pi-ui-el="keyValue"
        >
          {node.rows.map((row, i) => (
            <React.Fragment key={i}>
              <dt className="font-medium text-[hsl(var(--muted-foreground))]">
                {row.key}
              </dt>
              <dd className="text-[hsl(var(--foreground))]">{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      );

    case "table":
      return (
        <div key={key} className="overflow-x-auto" data-pi-ui-el="table">
          <table className="w-full border-collapse text-sm">
            {node.caption !== undefined ? (
              <caption className="mb-1 text-left text-xs text-[hsl(var(--muted-foreground))]">
                {node.caption}
              </caption>
            ) : null}
            <thead>
              <tr>
                {node.columns.map((col, i) => (
                  <th
                    key={i}
                    className="border-b border-[hsl(var(--border))] px-2 py-1 text-left font-medium text-[hsl(var(--muted-foreground))]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="border-b border-[hsl(var(--border))] px-2 py-1 text-[hsl(var(--foreground))]"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "image":
      // src 渲染前二次校验;不安全则不渲染 <img>(降级为 alt 文本,若有)。
      return isSafeImageSrc(node.src) ? (
        <img
          key={key}
          src={node.src}
          alt={node.alt ?? ""}
          loading="lazy"
          className={cn("max-w-full rounded-[var(--radius)]", textStyleClasses(node.style))}
          data-pi-ui-el="image"
        />
      ) : node.alt !== undefined ? (
        <span key={key} data-pi-ui-el="image">
          {node.alt}
        </span>
      ) : null;

    default:
      // 协议层已拒绝未知 el;此处为类型穷尽兜底。
      return null;
  }
}

export interface SandboxRendererProps {
  readonly node: UiNode;
}

export function SandboxRenderer({
  node,
}: SandboxRendererProps): React.JSX.Element {
  return (
    <div data-pi-ui-sandbox>{renderNode(node, "root", 0)}</div>
  );
}
