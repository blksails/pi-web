/**
 * 分档判据的**单一事实来源**(spec: test-tiering-fast-lane,design.md「守卫层 · tier-rules」)。
 *
 * 由测试文件的源文本判定它属于哪一档。被 `tier-guard.test.ts`(全量扫描守卫)与
 * `scripts/classify-tiers.mjs`(一次性归位清单生成)共用 —— 判据只此一份,不得复制。
 *
 * ★ 只做**直接**导入分析,不递归模块图。
 *   传递依赖扫描已被实测证伪:barrel(`src/agent-source/index.ts` 等)把整个模块图拉进来,
 *   198 个 fast 候选文件中有 116 个(59%)被误判(证据见 research.md §4.1)。
 *   「间接依赖」的真实危害由运行期哨兵(`test/setup/fast-sentinel.ts`)兜底 ——
 *   那才是间接依赖真正造成伤害的时刻。
 */

/** 四个档位。fast 与 fastMock 同属快档,差别只在是否需要模块隔离。 */
export type TestTier = "fast" | "fastMock" | "it" | "e2e";

/**
 * 严格性序。守卫允许**过度声明**(声明得比判定更严),但不允许声明得更宽松:
 * 一个纯逻辑测试挂 `.it.test.ts` 只是跑得慢些,而一个起子进程的测试挂 `.test.ts`
 * 会毒化快档。故比较用 `>=` 而非 `===`。
 */
export const TIER_STRICTNESS: Readonly<Record<TestTier, number>> = {
  fast: 0,
  fastMock: 1,
  it: 2,
  e2e: 3,
};

/** 触发降档的具体证据。4.3 要求报出「具体依赖」而非仅「存在违规」,故带 detail 与行号。 */
export interface TierEvidence {
  readonly kind: "direct-import" | "temp-dir" | "module-mock" | "credential-gate";
  /** 命中的 specifier 或 API 名,例如 "e2b"、"node:child_process"、"mkdtemp"。 */
  readonly detail: string;
  /** 1-based 行号,便于开发者直接跳转。 */
  readonly line: number;
}

export interface TierClassification {
  readonly tier: TestTier;
  readonly evidence: readonly TierEvidence[];
}

/**
 * 禁止在 fast 档**直接导入**的 specifier(前缀匹配,`x` 命中 `x` 与 `x/...`)。
 *
 * 收录理由各不相同,不是同一类东西堆在一起:
 * - `node:child_process` / `child_process`:起真实子进程,快档的头号毒源。
 * - `@earendil-works/pi-coding-agent` / `pi-ai`:agent 运行时 SDK,加载即拉起重模块图。
 * - `e2b`:云沙箱 SDK。
 * - `pg`:数据库驱动。
 * - `@modelcontextprotocol/sdk`:MCP SDK。
 * - `@pi-clouds/registry-client`:包注册表客户端。
 */
export const FORBIDDEN_DIRECT_IMPORTS: readonly string[] = [
  "node:child_process",
  "child_process",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "e2b",
  "pg",
  "@modelcontextprotocol/sdk",
  "@pi-clouds/registry-client",
];

/** 档位后缀 → 档位。顺序敏感:`.mock.test.ts` 必须先于 `.test.ts` 匹配。 */
const SUFFIX_TIERS: readonly (readonly [string, TestTier])[] = [
  [".it.test.ts", "it"],
  [".e2e.test.ts", "e2e"],
  [".mock.test.ts", "fastMock"],
  [".test.ts", "fast"],
];

/** 由文件名反推**声明**的档位。未知后缀按 fast 处理(最宽松,故守卫必然会拦住真违规者)。 */
export function tierFromFilename(filename: string): TestTier {
  const base = filename.replace(/^.*[/\\]/, "");
  for (const [suffix, tier] of SUFFIX_TIERS) {
    if (base.endsWith(suffix)) return tier;
  }
  return "fast";
}

const IMPORT_RE = /(?:^|[^\w$])(?:from|import|require)\s*\(?\s*["']([^"']+)["']/;

/**
 * 把注释内容抹成空格,**保留换行**使行号不变。
 *
 * ★ 这不是锦上添花,是判据的正确性前提。不剥注释时,本仓库里大量文件会因注释里提到
 *   `spawn` / `from "node:child_process"` / `vi.mock(` 而被误判 —— 早期手工 grep 划分
 *   重量级文件时,29 个命中里就有 4 个是这种误报(research.md §2.1)。
 *   连本判据自己的单测文件都会被自己的文档注释打中(实测,任务 2.1 dogfood 时发现)。
 *
 * **不**剥字符串字面量:`import x from "e2b"` 的 specifier 本身就住在字符串里,剥了就什么都识别不出。
 * 代价是源码里手写的「长得像 import 的字符串」会被计入 —— 这是已知且可接受的理论盲区,
 * 由运行期哨兵兜底;需要规避的自测可把关键 token 用插值拆开。
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; } else out += " ";
      i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i += 1; continue;
    }
    // 字符串/模板串内:原样保留,处理转义与收尾。
    if (c === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "template" && c === "`")) {
      state = "code";
    }
    out += c; i += 1;
  }
  return out;
}

/**
 * 收集**工厂式** `vi.mock` 的 specifier —— `vi.mock(spec, factory)` 且 factory 体内不含
 * `importOriginal` 时,真实模块**从不加载**,故该 specifier 不构成真实依赖。
 *
 * ★ 漏掉这条会误伤 `e2b-transport` 与 `sandbox-ws-transport` 两个合法的 fast 测试 ——
 *   它们 `vi.mock("e2b", () => ...)` 注入假 SDK,真实 e2b 从未被加载。
 *
 * 实现取巧但足够:从 `vi.mock("spec"` 起,截到下一个 `vi.mock(` 或文件尾,在这段里找
 * `importOriginal`。工厂体可能跨多行且含嵌套括号,正则匹配整个工厂体不现实。
 */
function collectFactoryMockedSpecifiers(source: string): ReadonlySet<string> {
  const out = new Set<string>();
  const starts: { spec: string; at: number }[] = [];
  const re = /vi\.mock\(\s*["']([^"']+)["']\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) starts.push({ spec: m[1]!, at: m.index });
  for (let i = 0; i < starts.length; i += 1) {
    const cur = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.at : source.length;
    if (!source.slice(cur.at, end).includes("importOriginal")) out.add(cur.spec);
  }
  return out;
}

function matchForbidden(specifier: string): string | undefined {
  return FORBIDDEN_DIRECT_IMPORTS.find(
    (f) => specifier === f || specifier.startsWith(`${f}/`),
  );
}

/**
 * 由源文本判定档位。**纯函数**:不触碰文件系统、不依赖时间与随机数,同一输入恒得同一结果。
 *
 * 判定顺序即优先级:it(最重)→ fastMock → fast。
 * ★ **不推断 e2e** —— 「整文件被外部凭据门控」难以稳定静态判定(门控可写成任意表达式),
 *   e2e 成员由文件名声明,守卫只保证「声明不得比判定宽松」。这是刻意的能力缺口,不是遗漏。
 */
export function classifyTestSource(source: string): TierClassification {
  const code = stripComments(source);
  const factoryMocked = collectFactoryMockedSpecifiers(code);
  const lines = code.split("\n");
  const evidence: TierEvidence[] = [];
  let hasModuleMock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNo = i + 1;

    const imported = IMPORT_RE.exec(line)?.[1];
    if (imported !== undefined && !factoryMocked.has(imported)) {
      const hit = matchForbidden(imported);
      if (hit !== undefined) {
        evidence.push({ kind: "direct-import", detail: imported, line: lineNo });
      }
    }

    // 真实临时目录 = 真实 fs 写入。`mkdtemp` / `mkdtempSync` 一并覆盖。
    if (/\bmkdtemp(Sync)?\s*\(/.test(line)) {
      evidence.push({ kind: "temp-dir", detail: "mkdtemp", line: lineNo });
    }

    if (/\bvi\.mock\s*\(/.test(line)) {
      hasModuleMock = true;
      evidence.push({ kind: "module-mock", detail: "vi.mock", line: lineNo });
    }
  }

  const heavy = evidence.filter((e) => e.kind === "direct-import" || e.kind === "temp-dir");
  if (heavy.length > 0) return { tier: "it", evidence };
  // 任何 `vi.mock` 都需要模块隔离:关隔离后同一 worker 内模块注册表共享,mock 可能不生效。
  if (hasModuleMock) return { tier: "fastMock", evidence };
  return { tier: "fast", evidence: [] };
}

/** 声明档位是否足以承载判定档位(允许过度声明,不允许过宽声明)。 */
export function isDeclarationAcceptable(declared: TestTier, classified: TestTier): boolean {
  return TIER_STRICTNESS[declared] >= TIER_STRICTNESS[classified];
}

/**
 * e2e 名册:**整文件**被外部服务/凭据门控者。静态判据刻意不推断 e2e(门控写法任意),
 * 故由名册显式声明。逐条依据见 research.md §2.2。
 *
 * ★ 名册同时是**防静默丢测**的闸门:e2e 是唯一离开默认路径的档,
 *   一个文件若挂了 `.e2e.test.ts` 却不在名册里,就会悄悄退出 CI —— 守卫必须拦住。
 *   (归位时真的撞见过两个:`extensions-schema.e2e.test.ts` 与
 *    `self-resolved-builtins.e2e.test.ts` 判定是 fast,却因历史命名带着 `.e2e`。)
 */
export const E2E_ROSTER: readonly string[] = [
  "test/rpc-channel/e2b-transport.e2e.test.ts",
  "test/rpc-channel/sandbox-ws-transport.e2e.test.ts",
  "test/rpc-channel/sandbox-ws-transport.pi.e2e.test.ts",
];

/**
 * it 名册(**运行期实测所得**)。这些文件不直接导入 `child_process`,而是经
 * `src/rpc-channel/pi-rpc-process.ts` 等模块间接起子进程、或对本地测试服务器发请求。
 * 静态直接导入分析原理上看不到它们(而传递分析 59% 误报,不可用)。
 * 由运行期哨兵扫描 fast 候选时暴露:204 个候选中 16 个文件 / 51 个用例违规。
 */
export const RUNTIME_DETECTED_IT: readonly string[] = [
  "test/attachment/http/http-attachment-registry.it.test.ts",
  "test/attachment/http/http-blob-store.it.test.ts",
  "test/auth/stub-egress.it.test.ts",
  "test/extensions/ext.e2e.it.test.ts",
  "test/extensions/ext.integration.it.test.ts",
  "test/http/http.e2e.it.test.ts",
  "test/http/http.integration.it.test.ts",
  "test/rpc-channel/pi-rpc-process.e2e.it.test.ts",
  "test/rpc-channel/pi-rpc-process.integration.it.test.ts",
  "test/rpc-channel/pi-rpc-process.lifecycle.it.test.ts",
  "test/rpc-channel/pi-rpc-process.restart.it.test.ts",
  "test/rpc-channel/pi-rpc-process.unit.it.test.ts",
  "test/session/pi-session.logging.realprocess.it.test.ts",
  "test/session/readiness.it.test.ts",
  "test/session/session.e2e.it.test.ts",
  "test/session/session.integration.it.test.ts",
];

/** 综合名册与源文本,给出一个文件**应当**声明的档位。 */
export function expectedTier(relPath: string, source: string): TestTier {
  if (E2E_ROSTER.includes(relPath)) return "e2e";
  if (RUNTIME_DETECTED_IT.includes(relPath)) return "it";
  return classifyTestSource(source).tier;
}
