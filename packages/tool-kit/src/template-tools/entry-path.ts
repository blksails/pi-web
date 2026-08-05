import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REL = "template-manager.ts";
const CWD_REL = "packages/tool-kit/src/template-tools/template-manager.ts";

let here: string | undefined;
try {
  here = path.dirname(fileURLToPath(import.meta.url));
} catch {
  here = undefined;
}

/** Resolve the built-in prompt-template creation extension without loading pi SDK. */
export function templateManagerEntryPath(): string | undefined {
  if (here !== undefined) {
    const fromHere = path.join(here, REL);
    if (existsSync(fromHere)) return fromHere;
  }
  const fromCwd = path.join(process.cwd(), CWD_REL);
  return existsSync(fromCwd) ? fromCwd : undefined;
}
