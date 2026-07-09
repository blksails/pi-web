/**
 * add-command — `pi-web add` 编排器(spec cli-component-add,任务 3.2,
 * Req 3.1, 3.2, 4.3, 5.5, 6.1–6.3, 7.x 分派, 10.1–10.2)。
 *
 * 只做穿针引线:全部判定归子域纯函数。流程级裁定(design §System Flows):
 *   - dry-run 在**全部校验与安装态判定之后**、任何写入之前短路(6.1);
 *   - `--force` 只降级 peer 校验为警告(4.3),对 modified 态无效(7.3);
 *   - 命令行为对目标 source 的唯一写点是 installer(其余全为只读)。
 * 退出码:成功/同版 no-op = 0;一切失败 = 1(10.1/10.2)。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createProgressReporter, type CliError, type ProgressReporter } from "../reporter.js";
import { resolveComponentSource, type ComponentSourceDeps } from "./component-source.js";
import { installComponentFiles } from "./installer.js";
import { validateComponentManifest } from "./manifest-validate.js";
import { checkPeers } from "./peer-check.js";
import {
  classifyInstallState,
  COMPONENT_PROVENANCE_FILENAME,
  type InstallState,
} from "./provenance.js";
import { unifiedDiff } from "./unified-diff.js";
import { buildWiringGuidance, renderWiringGuidance } from "./wiring-guidance.js";

export const ADD_USAGE = `用法: pi-web add <source> [options]

把组件包的源码安装(拷贝)进目标 agent source 的 .pi/web/components/<id>/。
代码拷入后归你所有,可自由修改;重复 add 具备幂等更新语义:
  未改动 + 来源新版本 → 覆盖并刷新溯源
  未改动 + 版本相同   → 不做任何写入
  有本地改动          → 打印上游 diff 并拒绝覆盖(--force 不改变此行为)

<source> 支持(v1):
  本地目录            ./my-component 或 /abs/path
  git 直连(须固定 ref) git:github.com/org/repo@v1.0.0#packages/my-component
                       (#<子目录> 可选,定位仓库内组件包根)

选项:
      --target <dir>  目标 agent source(缺省当前目录;须含 .pi/web/)
      --dry-run       执行全部校验并列出将写入的文件与接线指引,不写任何文件
      --force         peer 基线校验失败降级为警告继续(仅此;不覆盖本地改动)
  -h, --help          显示本帮助并退出
`;

export interface AddCommandOptions {
  readonly cwd?: string;
  readonly reporter?: ProgressReporter;
  /** 输出汇(usage/指引/diff 等非阶段性文本;缺省 console.log)。 */
  readonly write?: (line: string) => void;
  /** 溯源时间戳(测试注入定值)。 */
  readonly now?: () => Date;
  /** 来源解析注入(测试 fake git)。 */
  readonly sourceDeps?: ComponentSourceDeps;
}

function fail(reporter: ProgressReporter, stage: string, error: CliError): 1 {
  reporter.fail(stage, error);
  return 1;
}

/** `pi-web add` 入口:返回进程退出码。 */
export async function runAdd(argv: readonly string[], options: AddCommandOptions = {}): Promise<number> {
  const write = options.write ?? ((line: string) => console.log(line));
  const reporter = options.reporter ?? createProgressReporter({ write });
  const cwd = options.cwd ?? process.cwd();

  let parsed: {
    readonly values: { readonly [key: string]: string | boolean | undefined };
    readonly positionals: readonly string[];
  };
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        target: { type: "string" },
        "dry-run": { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    return fail(reporter, "add:args", { code: "invalid_arguments", message: (err as Error).message });
  }
  if (parsed.values["help"] === true) {
    write(ADD_USAGE);
    return 0;
  }
  const positional = parsed.positionals;
  if (positional.length !== 1 || positional[0] === undefined || positional[0].length === 0) {
    return fail(reporter, "add:args", {
      code: "invalid_arguments",
      message: `add 需要且仅需要一个 <source> 位置参数(收到 ${positional.length} 个);--help 查看用法`,
    });
  }
  const sourceArg = positional[0];
  const dryRun = parsed.values["dry-run"] === true;
  const force = parsed.values["force"] === true;

  // —— 目标 source 定位(3.1/3.2)——
  const targetOpt = parsed.values["target"];
  const targetSourceDir = path.resolve(cwd, typeof targetOpt === "string" ? targetOpt : ".");
  const piWebDir = path.join(targetSourceDir, ".pi", "web");
  if (!existsSync(piWebDir) || !statSync(piWebDir).isDirectory()) {
    return fail(reporter, "add:target", {
      code: "target_not_agent_source",
      message: `目标不是可接线的 agent source(缺少 .pi/web/ 目录): ${targetSourceDir}`,
    });
  }

  // —— 来源解析(2.x)——
  reporter.start("add:resolve", sourceArg);
  const source = await resolveComponentSource(sourceArg, { cwd, ...options.sourceDeps });
  if (!source.ok) return fail(reporter, "add:resolve", source.error);
  reporter.complete("add:resolve", source.value.origin);

  // —— 清单业务校验(1.x)——
  reporter.start("add:validate");
  const validated = validateComponentManifest(source.value.manifest);
  if (!validated.ok) {
    const issues = validated.issues;
    return fail(reporter, "add:validate", {
      code: issues[0]?.code ?? "component_spec_missing",
      message: issues.map((i) => `${i.field !== undefined ? `[${i.field}] ` : ""}${i.message}`).join("\n"),
    });
  }
  const { manifest, spec, targetRel } = validated.value;
  reporter.complete("add:validate", `${manifest.id}@${manifest.version}`);

  // —— peer 基线(4.x)——
  reporter.start("add:peers");
  const peers = checkPeers(spec.peer, targetSourceDir);
  if (!peers.ok) {
    const detail = peers.issues
      .map((i) => `  ${i.pkg}: 要求 ${i.required},实际 ${i.actual ?? "未找到"}`)
      .join("\n");
    if (peers.code === "peer_range_unsupported" || !force) {
      return fail(reporter, "add:peers", {
        code: peers.code,
        message:
          peers.code === "peer_range_unsupported"
            ? `清单 peer 范围写法不支持(仅精确、>=、^、~):\n${detail}`
            : `peer 基线不满足(--force 可降级为警告继续):\n${detail}`,
      });
    }
    write(`[pi-web] 警告:peer 基线不满足,已按 --force 继续:\n${detail}`);
  }
  reporter.complete("add:peers");

  // —— 安装态判定(7.x)——
  reporter.start("add:state");
  const destDir = path.join(targetSourceDir, targetRel);
  const state: InstallState = classifyInstallState(destDir, { version: manifest.version }, {
    destExists: (d) => existsSync(d),
    readFile: (d, rel) => {
      try {
        return readFileSync(path.join(d, rel));
      } catch {
        return null;
      }
    },
  });
  reporter.complete("add:state", state.state);

  if (state.state === "unmanaged") {
    return fail(reporter, "add:state", {
      code: "dest_unmanaged",
      message: `落点已存在但缺少 ${COMPONENT_PROVENANCE_FILENAME}(被非本安装器管理的内容占用): ${destDir}\n如确认可弃,请手动删除该目录后重装`,
    });
  }
  if (state.state === "modified") {
    // 逐文件 diff:来源新内容 vs 本地(7.3)。--force 不适用。
    let diffs = "";
    for (const rel of state.changed) {
      const localPath = path.join(destDir, rel);
      const localText = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
      const incomingPath = path.join(source.value.packRoot, rel);
      const incomingText = existsSync(incomingPath) ? readFileSync(incomingPath, "utf8") : "";
      diffs += unifiedDiff(rel, localText, incomingText);
    }
    write(diffs.trimEnd());
    return fail(reporter, "add:state", {
      code: "component_modified",
      message: `组件已被本地修改(${state.changed.join(", ")}),拒绝覆盖;请依上方 diff 手动合并,或删除落点目录后重装。--force 不适用于本地改动`,
    });
  }
  if (state.state === "clean-same-version") {
    write(`[pi-web] ${manifest.id}@${manifest.version} 已是该版本,未做任何写入。`);
    return 0;
  }

  const guidance = renderWiringGuidance(buildWiringGuidance(spec.wiring));

  // —— dry-run 短路:全部校验与态判定之后、任何写入之前(6.1–6.3)——
  if (dryRun) {
    write(`[pi-web] dry-run:将写入 ${targetRel}/ 下的文件:`);
    for (const f of [...spec.files, COMPONENT_PROVENANCE_FILENAME]) write(`  ${f}`);
    write(guidance);
    return 0;
  }

  // —— 写入(5.x)——
  reporter.start("add:write");
  const installed = installComponentFiles({
    packRoot: source.value.packRoot,
    files: spec.files,
    destDir,
    targetSourceDir,
    provenance: {
      id: manifest.id,
      version: manifest.version,
      origin: source.value.origin,
      installedAt: (options.now?.() ?? new Date()).toISOString(),
    },
  });
  if (!installed.ok) return fail(reporter, "add:write", installed.error);
  reporter.complete("add:write", `${installed.value.written.length} 个文件 → ${targetRel}/`);
  reporter.complete("add:provenance", COMPONENT_PROVENANCE_FILENAME);

  write(guidance);
  return 0;
}
