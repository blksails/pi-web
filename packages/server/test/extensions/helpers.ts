/**
 * extension-management 测试共享 helper:可注入的 FakePiCli(记录调用,模拟结果),
 * AuthContext 构造,审计收集器,以及 createPiWebHandler 装配器。
 */
import { createPiWebHandler } from "../../src/http/index.js";
import type { AuthContext } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createExtensionRoutes } from "../../src/extensions/routes.js";
import type {
  AuditRecord,
  ExtManagementOptions,
  InstalledExtension,
  PiCli,
  PiCommandResult,
} from "../../src/extensions/ext.types.js";

export interface PiCliCall {
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly opts?: { readonly timeoutMs?: number };
}

/** 记录调用并按配置回放结果的受控 pi CLI 替身(无网络 / 无子进程)。 */
export class FakePiCli implements PiCli {
  readonly runCalls: PiCliCall[] = [];
  listCalls = 0;

  private installed: InstalledExtension[];
  private runResult: (args: readonly string[]) => PiCommandResult;
  private listError: Error | undefined;

  constructor(opts: { installed?: InstalledExtension[] } = {}) {
    this.installed = opts.installed ?? [];
    this.runResult = () => ({ ok: true, stdout: "", exitCode: 0 });
  }

  setRunResult(fn: (args: readonly string[]) => PiCommandResult): void {
    this.runResult = fn;
  }

  setListError(err: Error): void {
    this.listError = err;
  }

  setInstalled(list: InstalledExtension[]): void {
    this.installed = list;
  }

  runPiCommand(
    args: readonly string[],
    env: Record<string, string>,
    opts?: { readonly timeoutMs?: number },
  ): Promise<PiCommandResult> {
    this.runCalls.push(opts !== undefined ? { args, env, opts } : { args, env });
    const result = this.runResult(args);
    // 模拟 install/remove 对清单的影响,使 install→list→remove 链路可断言。
    if (result.ok && args[0] === "install" && typeof args[1] === "string") {
      const id = args[1];
      if (!this.installed.some((e) => e.id === id)) {
        this.installed = [...this.installed, { id, kind: "npm", scope: "global" }];
      }
    }
    if (result.ok && args[0] === "remove" && typeof args[1] === "string") {
      this.installed = this.installed.filter((e) => e.id !== args[1]);
    }
    return Promise.resolve(result);
  }

  listExtensions(): Promise<readonly InstalledExtension[]> {
    this.listCalls += 1;
    if (this.listError !== undefined) {
      return Promise.reject(this.listError);
    }
    return Promise.resolve([...this.installed]);
  }
}

export const adminAuth: AuthContext = { anonymous: false, userId: "root" };
export const userAuth: AuthContext = { anonymous: false, userId: "alice" };
export const anonAuth: AuthContext = { anonymous: true };

/** 收集审计记录的接缝。 */
export function auditCollector(): {
  records: AuditRecord[];
  onAudit: (r: AuditRecord) => void;
} {
  const records: AuditRecord[] = [];
  return { records, onAudit: (r) => records.push(r) };
}

/** 构造一个挂载了扩展路由的 createPiWebHandler;authResolver 注入指定身份。 */
export function makeHandlerWith(
  extOpts: Omit<ExtManagementOptions, "store" | "manager"> & {
    store?: InMemorySessionStore;
    manager?: SessionManager;
  },
  auth: AuthContext = anonAuth,
): {
  handler: (req: Request) => Promise<Response>;
  store: InMemorySessionStore;
  manager: SessionManager;
} {
  const store = extOpts.store ?? new InMemorySessionStore(true);
  const manager = extOpts.manager ?? new SessionManager({ store, idleMs: 0 });
  const routes = createExtensionRoutes({ ...extOpts, store, manager });
  const handler = createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => auth,
  });
  return { handler, store, manager };
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}
