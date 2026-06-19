"use client";
/**
 * EmptyState — 空态欢迎页(标题/副标题/起始卡片网格 + 内联交互 + 输入框),从 pi-chat.tsx
 * 空态分支抽出为可覆盖元件(pi-chat-customization 任务 2.3)。
 *
 * 默认外观与抽出前一致(Req 1.1):用既有 Suggestions(grid)渲染起始卡片。当提供
 * `StarterCard` 覆盖时改为自渲染卡片网格(Req 5.1/5.2)。可整体由 components.EmptyState
 * 或 slots.empty 替换(Req 4.2)。
 */
import * as React from "react";
import type { Suggestion } from "@pi-web/react";
import { Suggestions } from "./suggestions.js";
import type { StarterCardProps } from "./starter-card.js";
import { cn } from "../lib/cn.js";

export interface EmptyStateProps {
  readonly title: string;
  readonly subtitle: string;
  /** 起始建议项(真实 suggestions 为空时的回落)。 */
  readonly starters: ReadonlyArray<Suggestion>;
  readonly onFill: (value: string) => void;
  readonly onSend: (value: string) => void;
  /** 空态内联交互卡(扩展 UI)。 */
  readonly interaction?: React.ReactNode;
  /** 输入框节点(由装配层注入)。 */
  readonly input?: React.ReactNode;
  /** 单卡覆盖;提供时改为自渲染卡片网格。 */
  readonly StarterCard?: React.ComponentType<StarterCardProps>;
  readonly className?: string;
}

export function EmptyState({
  title,
  subtitle,
  starters,
  onFill,
  onSend,
  interaction,
  input,
  StarterCard,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn("w-full max-w-3xl", className)}
      data-pi-empty-state
    >
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
          {title}
        </h1>
        <p className="mt-3 text-base text-[hsl(var(--muted-foreground))]">
          {subtitle}
        </p>
      </div>

      <div className="mb-4" data-pi-chat-suggestions>
        {StarterCard !== undefined ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            data-pi-suggestions
            data-pi-suggestions-layout="grid"
          >
            {starters.map((item) => (
              <StarterCard
                key={item.id}
                item={item}
                onFill={onFill}
                onSend={onSend}
              />
            ))}
          </div>
        ) : (
          <Suggestions
            items={starters}
            layout="grid"
            onFill={onFill}
            onSend={onSend}
          />
        )}
      </div>

      {interaction !== undefined ? (
        <div className="mb-4">{interaction}</div>
      ) : null}

      {input}
    </div>
  );
}
