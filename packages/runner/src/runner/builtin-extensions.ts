/**
 * builtin-extensions — pi-web 自带内置扩展的**单一清单**与自解析
 * (spec: runner-self-resolved-builtins,任务 1.2;Req 1.1, 1.3, 1.4, 1.5, 5.2, 5.3)。
 *
 * ## 为什么要自解析
 *
 * 此前内置扩展经「主进程算绝对路径 → spawn env 下发 → runner 读 env」注入,隐含前提是
 * **主进程与 runner 处于同一文件系统**。本地传输成立;e2b 沙箱传输下 runner 跑在远程容器,
 * 宿主机绝对路径在容器内不存在(且这些 env 也不在沙箱透传白名单内)——结果是内置扩展在
 * 沙箱下**静默不可用**。
 *
 * 改为 runner 侧自解析后:各 entry-path 函数用自身 `import.meta.url` 推算入口,而 runner
 * 的模块解析根是**引导脚本所在的包目录**(`runner-bootstrap.mjs` 的 `createJiti(here)`)
 * —— 自 spec runner-package-extraction 起该目录是 **runner 包**(此前是 server 包);
 * tool-kit 是 runner 包的运行时依赖,故这些模块位于其 `node_modules` 内,推算结果在
 * **任何形态**(本地 monorepo / 沙箱镜像 / standalone)都是该环境下的有效路径。
 * **零新解析机制**。
 *
 * ## 清单范围(★ 只含 pi-web 自带的内置扩展)
 *
 * 不含 sandbox enforcement:其入口**在 agent 包内**(由 source 决定,须传 agentDir,见
 * `../sandbox/entry.ts` 文件头),属 **agent 作用域**扩展,无法也不应从自身模块位置推算。
 * 它保持既有的 `PI_WEB_SANDBOX_ENTRY` 链路不变。
 *
 * ## 新增内置扩展怎么做
 *
 * 只在 {@link BUILTIN_EXTENSIONS} 数组里加一项 —— 不再需要在主进程下发、e2b 白名单等多处
 * 接线(那正是历史上「漏改一处即静默失效」的成因,Req 5.1/5.2)。
 */
import { createLogger } from "@blksails/pi-web-logger";
import { autoTitleEntryPath } from "@blksails/pi-web-tool-kit/auto-title-entry";
import { extensionManagerEntryPath } from "@blksails/pi-web-tool-kit/extension-entry";
import { mcpEntryPath } from "@blksails/pi-web-tool-kit/mcp-entry";
import { templateManagerEntryPath } from "@blksails/pi-web-tool-kit/template-entry";

const log = createLogger({ namespace: "runner:builtin-extensions" });

/** 一个 pi-web 自带内置扩展的解析说明。 */
export interface BuiltinExtensionSpec {
  readonly id: "extension-tools" | "auto-title" | "mcp" | "template-manager";
  /** 从自身模块位置推算入口绝对路径;解析不到返回 undefined。 */
  readonly resolve: () => string | undefined;
}

/**
 * 内置扩展单一清单(Req 5.2)。
 *
 * 顺序即注入顺序,**保持稳定**(Req 1.5):沿用改造前 `collectForcedExtensionPaths` 的相对
 * 次序 ext-tools → auto-title → mcp,使本地行为与改造前一致(Req 3.1)。
 *
 * ⚠ 门控不在此处:各扩展自身的启用开关(如自动标题的 `PI_WEB_AUTO_TITLE`、MCP 条目的
 * `enabled`)由扩展内部/配置层判定。清单只回答「代码在不在安装树里」。
 */
export const BUILTIN_EXTENSIONS: readonly BuiltinExtensionSpec[] = [
  { id: "extension-tools", resolve: extensionManagerEntryPath },
  { id: "auto-title", resolve: autoTitleEntryPath },
  { id: "mcp", resolve: mcpEntryPath },
  { id: "template-manager", resolve: templateManagerEntryPath },
];

/** 诊断出口的最小视图(默认 `process.stderr`;单测注入以捕获)。 */
export interface DiagnosticSink {
  write(s: string): unknown;
}

/**
 * 解析全部可用的内置扩展入口。
 *
 * - 顺序稳定(Req 1.5);
 * - 解析不到的条目**跳过并记诊断**,不抛出(Req 1.4/5.3)——某形态的安装树缺该代码时
 *   降级为该能力不可用,而非会话失败;
 * - 单个条目抛错同样被吞掉(entry-path 内部理论上不抛,此处为防御)。
 *
 * ★ 诊断同时走 logger 与 stderr:日志**默认关闭**,只记 log 等于「fail-soft + 默认静音」
 *   —— 用户看到的是「MCP / 自动标题莫名不工作」且无任何线索。这里丢的是一整个**能力**,
 *   不是一次调用失败,可见性必须无条件(与 runner 装配期其他能力级失败同一处置)。
 *
 * @param specs 注入点:便于单测替换清单。缺省用 {@link BUILTIN_EXTENSIONS}。
 * @param diag  诊断出口(默认 `process.stderr`);单测注入以避免噪声并直接断言。
 */
export function resolveBuiltinExtensionEntries(
  specs: readonly BuiltinExtensionSpec[] = BUILTIN_EXTENSIONS,
  diag: DiagnosticSink = process.stderr,
): readonly string[] {
  const entries: string[] = [];
  for (const spec of specs) {
    let resolved: string | undefined;
    try {
      resolved = spec.resolve();
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("builtin extension entry resolve threw", { id: spec.id, error });
      diag.write(`runner: builtin extension "${spec.id}" resolve threw: ${error}\n`);
      continue;
    }
    if (resolved === undefined || resolved.length === 0) {
      // Req 5.3:不可解析对维护者可观测,而非无声缺失。
      log.warn("builtin extension entry not resolvable in this install tree", { id: spec.id });
      diag.write(
        `runner: builtin extension "${spec.id}" not resolvable in this install tree ` +
          `(capability unavailable for this session)\n`,
      );
      continue;
    }
    entries.push(resolved);
  }
  return entries;
}
