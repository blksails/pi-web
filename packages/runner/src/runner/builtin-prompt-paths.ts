import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = "skill-create.md";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/** 全局内置 prompt template 路径；解析失败则静默跳过，不阻断 Agent 启动。 */
export function resolveBuiltinPromptTemplatePaths(): readonly string[] {
  const candidates = [
    ...(here === undefined ? [] : [path.join(here, FILE)]),
    path.join(process.cwd(), "packages/runner/src/runner", FILE),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found === undefined ? [] : [found];
}
