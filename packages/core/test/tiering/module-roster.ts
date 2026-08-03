/**
 * `src/` 顶层模块的**层归属名册**(spec: kernel-boundary-decoupling,任务 1.1)。
 *
 * 内核提取波次要把 `packages/server` 切成 core / runner / adapters 三包。切包之前,
 * 包内的依赖方向必须已经对三分成立 —— 否则一搬文件就变成循环或反向依赖。
 * 本名册是那条判据的事实来源,由 `dependency-guard.test.ts` 消费。
 *
 * 层序(依赖只能从右往左):
 *
 *     neutral  ←  core  ←  { runner, adapters }  ←  assembly
 *
 * - **neutral**:不属于任何一层的**纯逻辑**,被多层共用。判据是「零业务依赖、
 *   只用 node builtins 或纯计算」。放错层的代价是它会把某一层拖进另一层。
 * - **core**:headless 内核 —— 会话引擎、传输抽象、框架无关 HTTP、宿主契约端口。
 * - **runner**:子进程实现,值导入 pi SDK 与 jiti。
 * - **adapters**:绑定具体外部系统(云沙箱 / 数据库 / 对象存储 / LLM 网关 / 凭据 / 包注册表)。
 * - **assembly**:把上面三层**组装**起来的那一层 —— 主 barrel 与默认能力面清单。
 *   它按定义会同时引用 core 与 adapters,那不是违规而是它的职责。切包时它**留在兼容层包**,
 *   不进 core 包。★ 这条是守卫实测揪出来的:初版名册把它俩归为 core,于是报出 11 条假边。
 *
 * ★ 新增 `src/` 顶层模块时**必须**在此归类,否则守卫报红。这是刻意的:
 *   一个默认无人管的新模块,正是边界腐化的入口。
 *
 * ★ 名册按**层**归类,不按**包**归类(spec: core-package-extraction,任务 2.1 起本文件住在 core)。
 *   模块搬进哪个包是层归属的**结果**,不是另一份需要维护的事实 —— 两份事实必然漂移。
 *   包根清单另见 `package-roots.ts`;同名模块在不同包里含义不同时,用 `ROSTER_OVERRIDES`。
 */

export type Layer = "neutral" | "core" | "runner" | "adapters" | "assembly";

/** 层序。数值越小越底层;依赖只允许指向**不大于**自身的层。 */
export const LAYER_ORDER: Readonly<Record<Layer, number>> = {
  neutral: 0,
  core: 1,
  runner: 2,
  adapters: 2,
  assembly: 3,
};

/**
 * 每个模块的层归属。键是 `src/` 下的顶层目录名或顶层单文件名(不含 `.ts`)。
 *
 * 归类依据逐条可查:adapters 的判据是「绑定某个具体外部系统」,
 * core 的判据是「不绑定任何外部系统的宿主能力」。
 */
export const MODULE_ROSTER: Readonly<Record<string, Layer>> = {
  // ── neutral:纯逻辑,多层共用 ────────────────────────────────
  "source-key": "neutral", // 源标识键派生(仅 node:crypto)
  "host-contract-version": "neutral", // 契约版本常量与错误类型(零 import)
  "template-name": "neutral", // 镜像/模板命名派生(仅 node:crypto);任务 2.1 迁入
  "model-provider-names": "neutral", // provider 命名空间常量;三层共享的标识,任务 4.2 迁入 // 镜像/模板命名派生(仅 node:crypto);任务 2.1 迁入

  // ── core:headless 内核 ────────────────────────────────────
  "agent-definition": "core", // agent 编写契约(全 import type,pi SDK 仅类型);任务 4.1 由 runner 上移
  "agent-source": "core",
  "agent-source-list": "core",
  attachment: "core",
  "attachment-bridge": "core",
  "builtin-agents": "core",
  capability: "core",
  commands: "core",
  completion: "core",
  config: "core",
  "config-domain": "core",
  "host-manifest": "core",
  http: "core",
  logging: "core",
  "model-catalog": "core",
  plugin: "core",
  "rpc-channel": "core", // 传输**抽象**;e2b 具体实现属 adapters,由后续 spec 分离
  sandbox: "core", // 沙箱入口解析(纯路径逻辑,不绑定具体沙箱厂商)
  session: "core",
  "session-actions": "core",
  "session-list": "core",
  "session-meta": "core", // 会话展示元数据索引(端口 + 集中 JSON 文件实现);仅 node builtins

  "session-store": "core", // 接口与内存实现;postgres 实现属 adapters,由后续 spec 分离
  state: "core",
  trust: "core",
  workspace: "core",
  // aigc-settings 已随 multi-gateway-providers 任务 4.3 整体删除(GET /aigc/models 端点
  // 合入 GET /config/models,Req 3.2);不再是独立模块。
  "vision-settings": "core", // 薄设置读写路由(现只余纯类型,路由已随任务 4.3 删除)
  "parent-watchdog": "core",

  // ── runner:子进程实现 ─────────────────────────────────────
  runner: "runner",

  // ── assembly:组装层,按定义同时引用 core 与 adapters ─────────
  index: "assembly", // 主 barrel
  compat: "assembly", // 四个子路径的薄转发面(实现已随内核搬走);只转发,不增不减
  "runner-bootstrap-path": "assembly", // 只**解析** runner 包的 runner-bootstrap.mjs 路径,绝不 import 其实现(见其文件头)
  "host-assembly": "assembly", // 默认能力面清单;其文件头自述「import 真实工厂,绝不经主 barrel 导出」

  // ── adapters:绑定具体外部系统 ──────────────────────────────
  "ai-gateway": "adapters", // Cloudflare 等 AI 网关
  auth: "adapters", // 桌面凭据 / egress
  identity: "adapters", // 身份端口的具体实现
  "llm-gateway": "adapters", // dev/自部署 LLM 网关
  "sandbox-image": "adapters", // 云沙箱镜像烘焙
  extensions: "adapters", // 包安装(注册表 / 网络)
  tokens: "adapters", // 分面 scoped token 签发(与凭据体系绑定)
  // ↓ core-package-extraction 任务 4.1 从内核摘出:判据是"值依赖 e2b / pg / MCP SDK",
  //   而内核包的依赖声明不得出现这三者(R1.2)。内核走源码直连分发,消费方 tsc 会编译到
  //   每个文件,故"声明成 optional peer"在本仓不可用 —— 缺类型即编译失败。
  "sandbox-transport": "adapters", // e2b / ws-runner 传输实现 + 配置与模板解析(依赖 e2b)
  "session-store-postgres": "adapters", // pg 实现 + 按 env 选型的构造工厂(依赖 pg)
  "mcp-probe": "adapters", // MCP 探测实现(依赖 MCP SDK);内核只留端口 config/mcp-probe-port
  "model-sources": "adapters", // 取自 agent 运行时 SDK 的模型取数闭包(值导入 SDK,违 R1.3 故摘出)
  "attachment-example-tool": "adapters", // 示例工具(值导入 agent SDK);零生产引用,仅测试消费
};

/**
 * 显式豁免的跨层边。
 *
 * ★ 每条豁免**必须写出理由** —— 一条没有理由的豁免，和一个漏网的违规长得一模一样。
 * ★ `typeOnly: true` 的豁免只对 `import type` 成立;同一对模块的**值导入**仍会被拦。
 */
export const ALLOWED_EDGES: readonly {
  readonly from: string;
  readonly to: string;
  readonly typeOnly: boolean;
  readonly why: string;
}[] = [
  // ★ 曾有两条 typeOnly 豁免(capability→auth、builtin-agents→runner),已在
  //   core-package-extraction 任务 4.1 **消除**而非保留:两个被引用的目标都是纯类型文件,
  //   把它们归位到契约侧(egress-model → capability,agent-definition → 顶层 core 模块)
  //   即让方向自然成立。豁免能少一条就少一条 —— 每条豁免都是一处后人要重新判断的地方。
  {
    from: "runner",
    to: "host-assembly",
    typeOnly: false,
    why: "runner.ts 的 main() 以**动态** import 组合 host-assembly/model-sources(装配内置模型源)。runner 有两条被支持的入口(runner-bootstrap.mjs 与直接跑 runner.ts,后者在其文件头被文档化,另有 2 个 it + 4 个 node e2e 这么起),装配缝只放在 bootstrap 会让直接入口静默丢掉模型源 —— 表现是「会话起得来但模型找不到」(实测被 egress 登录闭环用例抓到)。故必须落在两条入口的汇合点。用动态导入使其为**运行期组合**而非编译期依赖:拆包后由宿主提供该模块,runner 侧声明可选依赖。★ 守卫已一并扫描动态 import,本条是显式登记而非漏网。",
  },
];

/**
 * **已知欠债**:确实是违规、但本 spec 不修的跨层边。
 *
 * ★ 与 `ALLOWED_EDGES` 严格分开 —— 后者是「合法，不必修」，前者是「不合法，暂不修」。
 *   混在一起写，几个月后没人分得清哪些是设计、哪些是欠账。
 * ★ 守卫对本表的条目**不报错但计数**:条目只能减不能增(见 dependency-guard 的欠债断言),
 *   使欠债无法无声增长。
 */
export const KNOWN_DEBT: readonly {
  readonly from: string;
  readonly to: string;
  readonly why: string;
  readonly owner: string;
}[] = [
  // (空)—— 内核提取继承的唯一一条欠债 model-catalog → ai-gateway
  // 已由 core-package-extraction 任务 3.1 解除:合并能力改经 ModelCatalogServiceDeps 注入。
  // ★ 空表是**有意保留**的,不要删掉这个常量:下一次有人想「先欠着」时,
  //   这里是唯一合法的登记处,而守卫会盯着它只减不增。
];

/**
 * **按包根覆写**的层归属。用于同名模块在不同包里含义不同的情形。
 *
 * 目前只有一例:`index`。core 包的 `src/index.ts` 是**内核主入口**(只聚合 core 模块,
 * 层归 core);兼容层包的 `src/index.ts` 是**装配 barrel**(同时引用 core 与 adapters,
 * 层归 assembly)。两者同名但是两个不同的东西,不覆写就必然有一个被判错层。
 *
 * ★ 覆写表只应收录**真实的同名冲突**。拿它来绕过某条报红的边,等于关掉守卫。
 */
export const ROSTER_OVERRIDES: Readonly<Record<string, Readonly<Record<string, Layer>>>> = {
  core: { index: "core" },
};

/**
 * 由模块路径(相对 `src/`,如 `rpc-channel/foo.ts`)取其顶层模块名。
 *
 * ★ 扩展名要同时剥 `.ts` 与 `.js`:NodeNext 约定下 import specifier 写的是 `.js`
 *   (`../host-contract-version.js`),而磁盘上是 `.ts`。只剥一种会让顶层单文件模块查不到。
 */
export function moduleNameOf(relPathFromSrc: string): string {
  const first = relPathFromSrc.split("/")[0] ?? "";
  return first.replace(/\.(ts|js)$/, "");
}

/**
 * 取模块所属层。未知模块**抛错**而非静默归类 —— 新增模块必须显式表态。
 *
 * @param rootName 模块所在的包根短名;给定时先查该包根的覆写表。
 */
export function layerOf(moduleName: string, rootName?: string): Layer {
  const override = rootName === undefined ? undefined : ROSTER_OVERRIDES[rootName]?.[moduleName];
  const layer = override ?? MODULE_ROSTER[moduleName];
  if (layer === undefined) {
    throw new Error(
      `模块 "${moduleName}" 未在 MODULE_ROSTER 中归类。` +
        `新增 src/ 顶层模块时必须显式指定其层(neutral / core / runner / adapters),` +
        `否则它会成为边界腐化的入口。`,
    );
  }
  return layer;
}

/**
 * 是否为**跨层反向**依赖 —— 即依赖指向了比自身更外层的模块。
 *
 * `runner` 与 `adapters` 同序(都是 2):它们互不依赖,故彼此之间的边也算反向。
 */
export function isReverseEdge(from: Layer, to: Layer): boolean {
  if (from === to) return false;
  return LAYER_ORDER[to] >= LAYER_ORDER[from];
}
