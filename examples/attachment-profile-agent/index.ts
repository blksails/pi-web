/**
 * attachment-profile-agent — agent 具名附件 profile 的**端到端示例**(spec agent-attachment-profile)。
 *
 * 演示三件事:
 *  1. `attachmentProfile: "archive"` —— agent 只声明**名字**,引用宿主
 *     `PI_WEB_ATTACHMENT_BACKENDS` 拓扑里注册的具名后端;凭据/端点全在宿主,
 *     名字未注册 → 会话创建直接失败(白名单,防外泄/SSRF)。
 *  2. 该会话的**新写入**(前端上传 + 子进程工具产物)都落 "archive" 后端,
 *     且后端名固化进附件描述符(`backend` 字段)——读/分发按描述符权威路由,
 *     与会话生死无关。
 *  3. 两条声明式 route 让你**不经 LLM** 就能验证:`put-output` 在子进程落一个
 *     产物附件;`list-session` 列出本会话附件(可见每条的 backend 绑定)。
 *
 * 运维可经 `PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED=1` 整体关断:声明被忽略、
 * 回宿主默认写入目标,会话正常创建。拓扑样例与完整演练见 ./README.md。
 *
 * NOTE: `model` 故意省略 → 继承 ~/.pi/agent/settings.json 默认(与 hello-agent 同姿态)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type {
  AgentRouteDecl,
  AttachmentToolContext,
} from "@blksails/pi-web-agent-kit";

/**
 * runner 装配在子进程内把闭包绑定的 {@link AttachmentToolContext} 挂到该约定 key
 * (与 examples/attachment-tool-agent 的示例工具同一约定;seam 未注入时安全降级)。
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

/** 在子进程落一个小产物附件 → 应落到 profile 指向的后端并固化描述符 backend。 */
const putOutputRoute: AgentRouteDecl = {
  name: "put-output",
  description: "落一个工具产物附件(演示子进程写路径按 profile 路由)",
  handler: async () => {
    const ctx = getAttachmentToolContext();
    if (!ctx.available) {
      return { ok: false, error: "attachment capability unavailable" };
    }
    const ref = await ctx.putOutput({
      bytes: new TextEncoder().encode("hello from attachment-profile-agent\n"),
      name: "profile-demo.txt",
      mimeType: "text/plain",
    });
    return { ok: true, attachmentId: ref.attachmentId };
  },
};

/** 列出本会话附件描述符 —— 每条的 backend 字段即落库时固化的后端绑定。 */
const listSessionRoute: AgentRouteDecl = {
  name: "list-session",
  description: "列出本会话附件(观察描述符的 backend 绑定)",
  handler: async () => {
    const ctx = getAttachmentToolContext();
    if (!ctx.available) {
      return { ok: false, error: "attachment capability unavailable" };
    }
    const items = await ctx.listBySession();
    return {
      ok: true,
      count: items.length,
      items: items.map(
        (a: {
          id: string;
          name: string;
          origin: string;
          backend?: string;
        }) => ({
          id: a.id,
          name: a.name,
          origin: a.origin,
          backend: a.backend ?? "(默认后端,未固化)",
        }),
      ),
    };
  },
};

export default defineAgent({
  systemPrompt:
    "你是 attachment-profile-agent 示例。本会话新写入的附件会落到宿主注册的 " +
    "'archive' 后端(agent 定义经 attachmentProfile 声明)。用户上传附件后," +
    "你可以提示他们用 agent-routes(put-output / list-session)观察后端绑定。",
  noTools: "builtin",
  // 白名单引用:必须是宿主 PI_WEB_ATTACHMENT_BACKENDS 里注册的名字(见 README 拓扑样例);
  // 未注册 → 会话创建失败;关断 env 生效时被忽略、回宿主默认。
  attachmentProfile: "archive",
  routes: [putOutputRoute, listSessionRoute],
});
