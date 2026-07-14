/**
 * attachment-catalog-agent — agent 附件目录的**端到端示例**(spec agent-attachment-catalog)。
 *
 * 演示三件事:
 *  1. `attachmentCatalog: { list, resolve }` —— 一个纯内存目录(几份「报表」文本片段),
 *     `list(query)` 按名字子串过滤(每次 `@` 补全按键都会调,故保持内存化、零 IO);
 *     `resolve(entryId)` 惰性产出字节,只在用户真正选中(或提交期兜底)时才被调用一次
 *     (幂等复用由 runner 侧的 catalog 桥保证,agent 侧无需关心重复调用)。
 *  2. 一条声明式 route(`publish-demo`)演示 `ctx.publish(...)`:agent 在**运行期主动**
 *     落一个产物附件并广播「新增」事件,让已连接前端免刷新在 `@` 补全的 catalog 分组感知到
 *     ——与「用户主动发现目录条目」正交的另一条路径。
 *  3. 目录条目全程只在子进程内(list/resolve 均在此文件运行);主进程只见纯数据条目投影
 *     与物化后的标准 `att_` id,字节零跨进程。
 *
 * NOTE: `model` 故意省略 → 继承 ~/.pi/agent/settings.json 默认(与 hello-agent 同姿态)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type {
  AgentRouteDecl,
  AttachmentToolContext,
  CatalogEntry,
  CatalogResolved,
} from "@blksails/pi-web-agent-kit";

/**
 * runner 装配在子进程内把闭包绑定的 {@link AttachmentToolContext} 挂到该约定 key
 * (与 examples/attachment-tool-agent / attachment-profile-agent 同一约定;seam 未注入时
 * 安全降级)。
 */
const ATTACHMENT_CTX_KEY = "__piWebAttachmentToolContext__";

const UNAVAILABLE_CTX: AttachmentToolContext = {
  available: false,
  async resolve() {
    throw new Error("attachment capability unavailable");
  },
  async putOutput() {
    throw new Error("attachment capability unavailable");
  },
  async publish() {
    throw new Error("attachment capability unavailable");
  },
  async listBySession() {
    throw new Error("attachment capability unavailable");
  },
  async getMeta() {
    throw new Error("attachment capability unavailable");
  },
  async setMeta() {
    throw new Error("attachment capability unavailable");
  },
};

function getAttachmentToolContext(): AttachmentToolContext {
  const injected = (globalThis as Record<string, unknown>)[ATTACHMENT_CTX_KEY];
  if (
    injected != null &&
    typeof injected === "object" &&
    "available" in (injected as object)
  ) {
    return injected as AttachmentToolContext;
  }
  return UNAVAILABLE_CTX;
}

/**
 * 纯内存目录:几份固定「报表」文本片段。真实 agent 可以换成任何来源(数据库查询结果、
 * 云盘列举、动态生成的报表清单……),只要 `list` 保持够快(≈700ms 上限,超时降级为空组)。
 */
interface CatalogItem {
  readonly entry: CatalogEntry;
  readonly body: string;
}

const CATALOG: readonly CatalogItem[] = [
  {
    entry: {
      id: "monthly-report",
      name: "Monthly Report.txt",
      description: "本月运营简报(示例)",
      mimeType: "text/plain",
      version: "v1",
    },
    body: "Monthly Report\n===============\nRevenue: $12,345\nActive users: 678\n",
  },
  {
    entry: {
      id: "quarterly-summary",
      name: "Quarterly Summary.txt",
      description: "季度摘要(示例)",
      mimeType: "text/plain",
      version: "v1",
    },
    body: "Quarterly Summary\n=================\nQ1 growth: +12%\nChurn: 2.1%\n",
  },
  {
    entry: {
      id: "changelog",
      name: "Changelog.txt",
      description: "变更日志(示例)",
      mimeType: "text/plain",
      version: "v1",
    },
    body: "Changelog\n=========\n- Added attachment catalog demo\n- Fixed nothing (it's a demo)\n",
  },
];

/** 子序列/子串大小写不敏感匹配(与 attachment-provider 的模糊过滤同风格,足够演示用)。 */
function nameMatches(name: string, query: string): boolean {
  if (query === "") return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

function list(query: string): CatalogEntry[] {
  return CATALOG.filter((item) => nameMatches(item.entry.name, query)).map(
    (item) => item.entry,
  );
}

function resolve(entryId: string): CatalogResolved {
  const item = CATALOG.find((c) => c.entry.id === entryId);
  if (item === undefined) {
    throw new Error(`catalog entry not found: ${entryId}`);
  }
  return {
    bytes: new TextEncoder().encode(item.body),
    name: item.entry.name,
    mimeType: item.entry.mimeType ?? "text/plain",
  };
}

/**
 * 运行期主动推送演示:落一个产物附件并广播「新增」事件(与目录 list/resolve 正交—— 用户
 * 不用先在 `@` 补全里发现它,已连接前端会免刷新感知)。
 */
const publishDemoRoute: AgentRouteDecl = {
  name: "publish-demo",
  description: "主动落一个产物附件并广播推送事件(观察免刷新感知)",
  handler: async () => {
    const ctx = getAttachmentToolContext();
    if (!ctx.available) {
      return { ok: false, error: "attachment capability unavailable" };
    }
    const ref = await ctx.publish({
      bytes: new TextEncoder().encode(
        `pushed at ${new Date().toISOString()}\n`,
      ),
      name: "pushed.txt",
      mimeType: "text/plain",
    });
    return { ok: true, attachmentId: ref.attachmentId };
  },
};

export default defineAgent({
  systemPrompt:
    "你是 attachment-catalog-agent 示例。本会话提供一个动态附件目录(几份示例报表)," +
    "用户可在输入框敲 @ 触发补全,在「catalog」分组里发现并选中它们(选中后惰性物化为" +
    "标准附件)。你也可以经 publish-demo route 主动推送一个产物,前端会免刷新在 @ 补全里" +
    "看到它。",
  noTools: "builtin",
  attachmentCatalog: { list, resolve },
  routes: [publishDemoRoute],
});
