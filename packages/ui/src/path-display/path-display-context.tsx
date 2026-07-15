/**
 * PathDisplay — 聊天路径展示模式(settings.pathDisplay)。
 *
 * 模式经 React context 下发;渲染层(PartRenderer / 工具卡 / bash 卡)用
 * {@link useMaskPaths} 按当前模式折叠绝对 home 路径。仅影响 UI,不改 SSE/落盘原文。
 */
import * as React from "react";
import {
  DEFAULT_PATH_DISPLAY_MODE,
  maskPaths,
  maskPathsDeep,
  parsePathDisplayMode,
  type PathDisplayMode,
} from "@blksails/pi-web-protocol";

const PathDisplayContext = React.createContext<PathDisplayMode>(
  DEFAULT_PATH_DISPLAY_MODE,
);

export interface PathDisplayProviderProps {
  /** 显式模式;缺省 = {@link DEFAULT_PATH_DISPLAY_MODE}。 */
  readonly mode?: PathDisplayMode;
  readonly children: React.ReactNode;
}

/** 向下注入路径展示模式。 */
export function PathDisplayProvider({
  mode,
  children,
}: PathDisplayProviderProps): React.JSX.Element {
  const value = mode ?? DEFAULT_PATH_DISPLAY_MODE;
  return (
    <PathDisplayContext.Provider value={value}>
      {children}
    </PathDisplayContext.Provider>
  );
}

/** 读取当前路径展示模式。 */
export function usePathDisplayMode(): PathDisplayMode {
  return React.useContext(PathDisplayContext);
}

/** 返回绑定当前模式的 maskPaths 回调。 */
export function useMaskPaths(): (text: string) => string {
  const mode = usePathDisplayMode();
  return React.useCallback((text: string) => maskPaths(text, mode), [mode]);
}

/** 返回绑定当前模式的 maskPathsDeep 回调。 */
export function useMaskPathsDeep(): <T>(value: T) => T {
  const mode = usePathDisplayMode();
  return React.useCallback(
    <T,>(value: T) => maskPathsDeep(value, mode),
    [mode],
  );
}

export { parsePathDisplayMode, DEFAULT_PATH_DISPLAY_MODE };
export type { PathDisplayMode };
