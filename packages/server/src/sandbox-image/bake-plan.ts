/**
 * sandbox-image · 烘焙计划纯函数(`sandbox-baked-agent-image` spec,任务 1.2;Req 2.1-2.6)。
 *
 * 计算「基础镜像 + agent source → 专属镜像」的完整烘焙计划:staging 文件清单(收集 + 排除)、
 * bundle 入参形状(esbuild 入口与 externals)、Dockerfile 文本、镜像名/模板名与 tag——
 * **纯决策不落盘不 spawn**(与 `attachment/backends-config.ts` 同族的纯函数 + 组合根风格);
 * 读盘一律经注入的 {@link BakeFsPort},真实 fs 适配器归任务 3.1,单测用内存实现。
 *
 * 决策规则(design.md §bake-plan / research.md「源预编译」「烘焙镜像启动契约」):
 * - **入口探测**:先 `index.js` 后 `index.ts`(与基础镜像 resolveSpawnCommand 的探测序一致,
 *   见 research.md:child-process-like.ts 天然先探 index.js);两者都无 → `MISSING_ENTRY`。
 * - **收集**:`package.json`(存在则收)+ `.pi/` 递归全量(skills/config/web 源与 web/dist
 *   产物)。`bundle=true` 时 routes/ 等源文件与入口**不进 files**(由 esbuild bundle 内联,
 *   {@link BakePlan.bundleEntryPoint} 指向源入口绝对路径);`bundle=false` 时递归收全部源文件
 *   (运行时 jiti 编译),两种形态都应用排除规则。
 * - **排除**:{@link BAKE_EXCLUDES} 可查知常量(Req 2.5),含 `.pi/web/dist` 例外。
 * - **tag 缺省** = sourceDir 下**全部非排除源文件**字节的 sha256 前 12 位,输入按相对路径
 *   排序保确定性(同内容恒同 tag → docker 层缓存命中即 Req 2.3)。哈希输入刻意**宽于** files
 *   清单:bundle 模式下 routes/ 等源文件不进 files(被 esbuild 内联进产物),但它们决定
 *   bundle 产物内容——只哈希 files 会让「内容变了 tag 不变」,新镜像被旧 tag 掩盖,违反
 *   内容寻址语义(复核第 1 轮裁决的真实缺陷)。两形态哈希输入一致,故同源两形态同 tag。
 *   显式 `opts.tag` 优先。镜像名/模板名**复用 template-name 派生**(不重写逻辑),`plan.tag`
 *   取派生后镜像名中的最终 tag(显式 tag 含 `.` 时随 template-name 归一为 `-`,保证三者一致)。
 * - **Dockerfile**:`FROM <base>` + `COPY staged/ /workspace/agent/` + `ENV AGENT_CWD` +
 *   `ENV AGENT_CMD="node <runner-bootstrap 全局路径> --agent /workspace/agent/<entry> …"`——
 *   复用基础镜像 runner-entry 的 AGENT_CMD 兜底路径,沙箱内零新组件(Req 2.2/2.6)。
 */
import { createHash } from "node:crypto";
import { deriveImageName, deriveTemplateName } from "./template-name.js";

// ---------------------------------------------------------------------------
// 端口与结果类型
// ---------------------------------------------------------------------------

/**
 * 读盘端口(design.md §bake-plan 原文):纯函数经此注入读文件系统,单测用内存实现,
 * 真实 fs 适配器在任务 3.1(scripts 编排侧)。
 *
 * 契约:
 * - `exists(p)`:路径存在即 `true`(文件或目录);
 * - `listFiles(dir)`:**递归**列出 `dir` 下全部文件的**相对路径**(posix 分隔,仅文件不含目录);
 *   `dir` 不存在或不是目录时抛错;
 * - `readFile(p)`:读文件字节;不存在时抛错。
 */
export interface BakeFsPort {
  exists(p: string): boolean;
  listFiles(dir: string): string[];
  readFile(p: string): Buffer;
}

/**
 * 本地 Result 判别联合(仓内无既有可用的通用 Result 型;与 pi-clouds installer outcome
 * 风格一致:`ok` 判别 + `value`/`error` 载荷)。
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ---------------------------------------------------------------------------
// 接口(design.md §bake-plan Service Interface)
// ---------------------------------------------------------------------------

export interface BakePlanOptions {
  /** agent source 目录(绝对路径;同时作为 template-name 派生的 policySource 标识)。 */
  readonly sourceDir: string;
  /** 基础镜像(缺省 pi-clouds/agent-runner:pi,由调用方经 env 覆盖后传入)。 */
  readonly baseImage: string;
  /** 缺省 true;false = 拷源 + 沙箱运行时 jiti 编译(`--no-bundle` 逃生口)。 */
  readonly bundle: boolean;
  /** 显式 tag;缺省 = staging 内容哈希前 12 位。 */
  readonly tag?: string;
}

export type BakePlanError =
  | { readonly code: "MISSING_ENTRY"; readonly detail: string }
  | { readonly code: "SOURCE_NOT_DIR"; readonly detail: string };

export interface BakePlan {
  /** staging 拷贝清单(不含 bundle 产物):src=源内绝对路径,dest=staging 相对路径。 */
  readonly files: readonly { readonly src: string; readonly dest: string }[];
  /** 镜像内 AGENT_CMD 指向的入口文件名:index.js(bundle 产物)或源入口(--no-bundle)。 */
  readonly entry: "index.js" | "index.ts";
  /** bundle=true 时的 esbuild 入口(源入口绝对路径);--no-bundle 时无。 */
  readonly bundleEntryPoint?: string;
  /** esbuild externals(bundle 模式;镜像全局 node_modules 可解析)。 */
  readonly externals: readonly string[];
  /** Dockerfile 全文(FROM/COPY/ENV,见模块头)。 */
  readonly dockerfile: string;
  /** `piweb-agent/<slug>:<tag>`(template-name 派生)。 */
  readonly imageName: string;
  /** `piweb-agent-<slug>.<tag>`(template-name 派生,与 dynamic 规则互逆)。 */
  readonly templateName: string;
  /** 最终 tag(缺省=内容哈希;显式 tag 经 template-name 归一后的形态)。 */
  readonly tag: string;
}

// ---------------------------------------------------------------------------
// 排除规则(Req 2.5:可被开发者查知的常量导出)
// ---------------------------------------------------------------------------

/**
 * 烘焙排除规则:与运行无关/不该进镜像的内容(Req 2.5;Security:防 .git/本地缓存等
 * 敏感内容进镜像)。尾 `/` 表示目录规则(任意深度的同名路径段整棵排除),无尾 `/`
 * 表示文件名规则(任意深度的同名文件)。
 *
 * - `node_modules/` — 依赖由基础镜像全局 node_modules 解析(`/workspace/node_modules`
 *   symlink),源内安装目录进镜像既冗余又破坏层缓存;
 * - `.git/` — 版本控制目录(体积 + 敏感历史);
 * - `dist/` — 宿主本地构建产物,烘焙产物由本次 bundle 生成,陈旧 dist 会遮蔽;
 *   **例外:`.pi/web/dist` 必须保留**——那是 webext 运行产物(浏览器侧静态资产),
 *   不是宿主构建垃圾,沙箱内声明帧依赖它与宿主服务的资产同源(design §Existing
 *   Architecture Analysis),见 {@link PI_WEB_DIST_EXCEPTION};
 * - `.installed` — pi 安装标记文件(宿主态残留);
 * - `.cache/` / `.DS_Store` — 本地缓存与 Finder 元数据。
 */
export const BAKE_EXCLUDES: readonly string[] = [
  "node_modules/",
  ".git/",
  "dist/",
  ".installed",
  ".cache/",
  ".DS_Store",
];

/** `dist/` 目录规则的唯一例外前缀:webext 运行产物必须烘进镜像(理由见 {@link BAKE_EXCLUDES})。 */
export const PI_WEB_DIST_EXCEPTION = ".pi/web/dist";

/** 由 {@link BAKE_EXCLUDES} 派生的路径段集合(剥尾 `/`;目录与文件规则判定同为「段相等」)。 */
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set(
  BAKE_EXCLUDES.map((rule) => (rule.endsWith("/") ? rule.slice(0, -1) : rule)),
);

/**
 * 判定 staging 相对路径(posix)是否被排除:任一路径段命中 {@link EXCLUDED_SEGMENTS}
 * 即排除;唯一例外是 `dist` 段恰好构成 `.pi/web/dist` 前缀(webext 产物保留)。
 */
export function isBakeExcluded(relPath: string): boolean {
  const segments = relPath.split("/");
  for (const [i, segment] of segments.entries()) {
    if (!EXCLUDED_SEGMENTS.has(segment)) continue;
    if (
      segment === "dist" &&
      segments.slice(0, i + 1).join("/") === PI_WEB_DIST_EXCEPTION
    ) {
      continue;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// externals(bundle 模式 esbuild 用)
// ---------------------------------------------------------------------------

/**
 * bundle 模式 esbuild externals:pi SDK 两包按 `scripts/build-server.mjs` 的 `EXTERNAL`
 * 精确名 + `@blksails/*` 通配——三者都在基础镜像全局 node_modules 中,经
 * `/workspace/node_modules → 全局` symlink 向上解析(design「烘焙镜像契约」)。
 */
export const BAKE_BUNDLE_EXTERNALS: readonly string[] = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@blksails/*",
];

// ---------------------------------------------------------------------------
// 内部规则
// ---------------------------------------------------------------------------

/** 入口探测序:先 js 后 ts(与基础镜像 resolveSpawnCommand 一致,见模块头)。 */
const ENTRY_CANDIDATES = ["index.js", "index.ts"] as const;

/** 沙箱内源固定落点(基础镜像 `/workspace/node_modules` symlink 的解析前提)。 */
const AGENT_WORKDIR = "/workspace/agent";

/** runner-bootstrap 全局安装路径(基础镜像 build 期已校验存在;挪动即 Revalidation Trigger)。 */
const RUNNER_BOOTSTRAP_PATH =
  "/usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs";

/** 缺省 tag(内容哈希)长度:sha256 hex 前 12 位。 */
const TAG_HASH_LEN = 12;

/** 生成 Dockerfile 全文(design「烘焙镜像契约」的固定四行 + 尾换行)。 */
function renderDockerfile(baseImage: string, entry: string): string {
  const agentCmd = `node ${RUNNER_BOOTSTRAP_PATH} --agent ${AGENT_WORKDIR}/${entry} --cwd ${AGENT_WORKDIR} --agent-dir /root/.pi/agent`;
  return [
    `FROM ${baseImage}`,
    `COPY staged/ ${AGENT_WORKDIR}/`,
    `ENV AGENT_CWD=${AGENT_WORKDIR}`,
    `ENV AGENT_CMD="${agentCmd}"`,
    "",
  ].join("\n");
}

/**
 * 计算缺省 tag:sourceDir 下**全部非排除源文件**(含入口与 bundle 模式下被内联的 routes/
 * 等源,已按相对路径排序)字节的 sha256 前 12 位。哈希输入宽于 staging files 清单的理由
 * 见模块头「tag 缺省」;路径与内容间以 NUL 定界,防「路径尾 + 内容头」拼接歧义。
 */
function computeContentTag(
  hashInputRelPaths: readonly string[],
  sourceDir: string,
  fs: BakeFsPort,
): string {
  const hash = createHash("sha256");
  for (const rel of hashInputRelPaths) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFile(`${sourceDir}/${rel}`));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, TAG_HASH_LEN);
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

/**
 * 计算烘焙计划(纯函数:同 fs 内容 + 同 opts 恒同输出)。
 *
 * 错误路径(Req 2.4):sourceDir 不存在或不是目录 → `SOURCE_NOT_DIR`;
 * 入口 `index.js`/`index.ts` 都缺 → `MISSING_ENTRY`(detail 指出缺失项)。
 */
export function computeBakePlan(
  opts: BakePlanOptions,
  fs: BakeFsPort,
): Result<BakePlan, BakePlanError> {
  const sourceDir = opts.sourceDir.replace(/\/+$/, "");
  if (!fs.exists(sourceDir)) {
    return {
      ok: false,
      error: {
        code: "SOURCE_NOT_DIR",
        detail: `source directory does not exist: ${sourceDir}`,
      },
    };
  }
  let allFiles: string[];
  try {
    allFiles = fs.listFiles(sourceDir);
  } catch {
    return {
      ok: false,
      error: {
        code: "SOURCE_NOT_DIR",
        detail: `source path is not a directory: ${sourceDir}`,
      },
    };
  }

  const entrySource = ENTRY_CANDIDATES.find((name) =>
    fs.exists(`${sourceDir}/${name}`),
  );
  if (entrySource === undefined) {
    return {
      ok: false,
      error: {
        code: "MISSING_ENTRY",
        detail:
          `agent source is missing an entry file: expected index.js or index.ts ` +
          `at ${sourceDir}`,
      },
    };
  }

  // 全部非排除源文件(排序):tag 哈希输入(两形态一致),也是 --no-bundle 的收集全集。
  const nonExcluded = allFiles.filter((rel) => !isBakeExcluded(rel)).sort();

  // 收集:bundle 模式只收 package.json + .pi/ 全量(源文件由 bundle 内联);
  // --no-bundle 递归收全部源文件。两种形态都应用排除规则(Req 2.1/2.5)。
  const included = opts.bundle
    ? nonExcluded.filter(
        (rel) => rel === "package.json" || rel.startsWith(".pi/"),
      )
    : nonExcluded;
  const files = included.map((rel) => ({
    src: `${sourceDir}/${rel}`,
    dest: rel,
  }));

  // tag:显式优先(空白视为缺省);缺省 = 全部非排除源内容哈希(宽于 files 清单,
  // 使 bundle 内联的 routes/ 等源变更也翻新 tag——内容寻址,Req 2.3/2.6)。
  const explicitTag = opts.tag?.trim();
  const rawTag =
    explicitTag !== undefined && explicitTag !== ""
      ? explicitTag
      : computeContentTag(nonExcluded, sourceDir, fs);

  // 命名:复用 template-name 派生(单一来源);plan.tag 取镜像名中的最终形态,
  // 保证显式 tag 含 `.` 时三者(tag/imageName/templateName)一致归一。
  const identity = { policySource: sourceDir };
  const imageName = deriveImageName(identity, rawTag);
  const templateName = deriveTemplateName(identity, rawTag);
  const tag = imageName.slice(imageName.lastIndexOf(":") + 1);

  const entry = opts.bundle ? "index.js" : entrySource;
  const plan: BakePlan = {
    files,
    entry,
    ...(opts.bundle ? { bundleEntryPoint: `${sourceDir}/${entrySource}` } : {}),
    externals: BAKE_BUNDLE_EXTERNALS,
    dockerfile: renderDockerfile(opts.baseImage, entry),
    imageName,
    templateName,
    tag,
  };
  return { ok: true, value: plan };
}
