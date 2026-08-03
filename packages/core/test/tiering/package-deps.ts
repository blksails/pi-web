/**
 * 内核包**声明层**的依赖判据(spec: core-package-extraction,R1.2 / R1.3 / R1.4)。
 *
 * ★ 与依赖方向守卫**分工不同**:那个查源码 `import`,这个查 `package.json`。
 *   两者缺一不可 —— 源码干净但声明里挂着 `e2b`,消费方照样得把它装下来,
 *   而本 spec 的全部价值就在那棵依赖树上。
 */

/** 内核包声明层禁止出现的依赖(前缀匹配,`x` 命中 `x` 与 `x/...`)。 */
export const FORBIDDEN_PACKAGE_DEPS: readonly { readonly name: string; readonly why: string }[] = [
  // `why` 是**跨包根**共用的一句话(禁令表是单一事实源,各包根规则只引名字),
  // 故不能写成只对内核成立的措辞 —— 兼容层同样禁它(本仓 hono 只在仓库根的入口进程里)。
  { name: "hono", why: "HTTP 框架 —— 库包一律只做框架无关的 Request/Response 处理" },
  { name: "e2b", why: "云沙箱 SDK" },
  { name: "pg", why: "数据库驱动" },
  { name: "@modelcontextprotocol/sdk", why: "MCP SDK" },
  { name: "@pi-clouds/registry-client", why: "包注册表客户端" },
  { name: "@blksails/registry-client", why: "包注册表客户端(npm 发布名)" },
  { name: "ws", why: "WebSocket 实现 —— 只有具体沙箱传输需要" },
];

/**
 * 只允许以 **peer** 形式出现的依赖(R1.3)。出现在 `dependencies` / `devDependencies`
 * 里即违规 —— 那会让每个消费方无条件装下整套 agent 运行时。
 *
 * ★ 本清单只决定「出现在 deps/devDeps 里算不算违规」,**不**决定「必须出现在谁的 peerDeps 里」
 *   —— 后者按包根声明(见测试文件 `PACKAGE_DEP_POLICIES` 的 `peerOnly`)。两者分开是必要的:
 *   `@earendil-works/pi-ai` 只有 adapters 包声明为 peer(spec adapters-package-extraction 任务 1.1
 *   定的两包 peer),内核与 runner 根本不引用它 —— 若把「必须在 peerDeps」也挂在本清单上,
 *   那两个包会因「没声明一个它们不用的 peer」凭空变红。
 */
export const PEER_ONLY_DEPS: readonly string[] = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
];

export interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface DepViolation {
  readonly name: string;
  /** 违规出现在哪个字段 —— 只报"有违规"而不报字段,修的人得自己翻三处。 */
  readonly field: "dependencies" | "devDependencies";
  readonly why: string;
}

function matches(declared: string, forbidden: string): boolean {
  return declared === forbidden || declared.startsWith(`${forbidden}/`);
}

/**
 * 审计包声明,返回违规项。纯函数:入参是已解析的 manifest 对象,不碰文件系统。
 *
 * ★ `devDependencies` **也要查**。一个"只在测试里用"的重依赖同样会进消费方的安装图
 *   —— 只要有人把它误列成 dependency,而那种笔误没有任何机制会拦。
 *   `peerDependencies` 不查:agent 运行时 SDK 正是要以 peer 形式出现在那里。
 */
export function auditPackageDeps(pkg: PackageManifest): readonly DepViolation[] {
  const out: DepViolation[] = [];
  for (const field of ["dependencies", "devDependencies"] as const) {
    for (const declared of Object.keys(pkg[field] ?? {})) {
      const hit = FORBIDDEN_PACKAGE_DEPS.find((f) => matches(declared, f.name));
      if (hit !== undefined) out.push({ name: declared, field, why: hit.why });
      if (PEER_ONLY_DEPS.some((p) => matches(declared, p))) {
        out.push({ name: declared, field, why: "agent 运行时 SDK 只能以 peer 形式声明(R1.3)" });
      }
    }
  }
  return out;
}
