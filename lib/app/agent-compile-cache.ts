/**
 * Agent runner 的 Node/V8 编译缓存策略。
 *
 * Node >= 22.19 会把已解析模块的编译结果落盘；同一份源码再次启动时复用，
 * 源码改变则由 Node 自行失效。这里只补默认目录，不覆盖用户显式配置。
 */
import path from "node:path";

const DEFAULT_CACHE_DIR = [".pi-web", "cache", "node-compile"] as const;

export function withAgentCompileCache(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): Record<string, string> {
  const result = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  if (result.NODE_COMPILE_CACHE !== undefined || result.NODE_DISABLE_COMPILE_CACHE === "1") {
    return result;
  }

  const configured = result.PI_WEB_NODE_COMPILE_CACHE?.trim();
  result.NODE_COMPILE_CACHE = configured !== undefined && configured !== ""
    ? path.resolve(configured)
    : path.join(homeDir, ...DEFAULT_CACHE_DIR);
  return result;
}
