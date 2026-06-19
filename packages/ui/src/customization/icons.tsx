"use client";
/**
 * 图标主题契约与注入机制(pi-chat-customization 任务 1.3)。
 *
 * 设计:`icons.tsx` 不内置任何默认图标,各元件以 `useIcon(slot, Fallback)` 取值并自带
 * fallback(既有 lucide 图标),从而保持本模块对 elements 零依赖(依赖方向:icons → elements)。
 * 集成方经 `IconsProvider` 下发 `IconTheme`;未命中的图标位回退各元件自带 fallback(Req 8.2)。
 */
import * as React from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";

/** 图标组件接收的 props(与 lucide 图标兼容:均为 SVG props 超集)。 */
export type IconProps = SVGProps<SVGSVGElement> & { readonly className?: string };
export type IconComponent = ComponentType<IconProps>;

/** 受支持的图标位(Req 8.1)。 */
export type IconSlot =
  | "send"
  | "stop"
  | "retry"
  | "attach"
  | "removeAttachment"
  | "model"
  | "modelCheck"
  | "speech"
  | "webSearch"
  | "copy"
  | "copied"
  | "thumbUp"
  | "thumbDown";

/** 集成方提供的图标主题;缺省的位回退元件自带 fallback。 */
export type IconTheme = Partial<Record<IconSlot, IconComponent>>;

const EMPTY_THEME: IconTheme = {};

const IconsContext = React.createContext<IconTheme>(EMPTY_THEME);

export interface IconsProviderProps {
  readonly icons?: IconTheme;
  readonly children: ReactNode;
}

/** 向子树下发图标主题。 */
export function IconsProvider({
  icons,
  children,
}: IconsProviderProps): React.JSX.Element {
  return (
    <IconsContext.Provider value={icons ?? EMPTY_THEME}>
      {children}
    </IconsContext.Provider>
  );
}

/**
 * 取某图标位实现:命中主题则用主题图标,否则回退 `fallback`(既有 lucide)。
 * 保留调用处的尺寸约束与可访问性标签语义(Req 8.3)。
 */
export function useIcon(slot: IconSlot, fallback: IconComponent): IconComponent {
  const theme = React.useContext(IconsContext);
  return theme[slot] ?? fallback;
}
