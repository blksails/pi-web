/**
 * e2e fixture agent — 真实装载 `visionExtension`,但注入一个**确定性的假附件上下文**。
 *
 * 为什么注入附件而不用真实 attachment store:e2e 关注的是
 * 「取图 → 选模型 → **解析凭据** → 调模型 → 呈现结论」这条链,附件落库是上游既有能力
 * (已由 attachment 自身的 spec 覆盖)。注入一张内置 1×1 PNG 使断言确定、无需起存储。
 *
 * `complete` **不注入** ⇒ 走真实 `completeSimple`,打向 e2e 起的 mock OpenAI 兼容 provider。
 * 由此 e2e 能在真实 HTTP 上验证「关键决策 1」:凭据来自 `models.json`(而非环境变量),
 * 若实现回落 env,mock provider 收到的 Authorization 就会不对,断言立刻红。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { makeVisionExtension } from "@blksails/pi-web-tool-kit/runtime";

/** 1×1 透明 PNG(确定性字节)。 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

const FAKE_ATTACHMENT = {
  id: "att_e2e_img",
  name: "e2e.png",
  mimeType: "image/png",
  size: PNG_BYTES.length,
  origin: "tool-output" as const,
  sessionId: "e2e",
  createdAt: "2026-07-09T00:00:00.000Z",
};

/** 结构同形的最小 AttachmentToolContext(只实现 vision 用到的三个成员)。 */
const fakeAttachmentCtx = {
  available: true,
  async resolve(id: string) {
    if (id !== FAKE_ATTACHMENT.id) throw new Error(`no such attachment: ${id}`);
    return {
      meta: FAKE_ATTACHMENT,
      async bytes() {
        return new Uint8Array(PNG_BYTES);
      },
      async localPath() {
        return "/tmp/e2e.png";
      },
      async url() {
        return "http://127.0.0.1/e2e.png";
      },
    };
  },
  async listBySession() {
    return [FAKE_ATTACHMENT];
  },
  async putOutput() {
    throw new Error("vision must not call putOutput");
  },
  async getMeta() {
    return undefined;
  },
  async setMeta() {
    /* no-op */
  },
};

export default defineAgent({
  systemPrompt: "e2e vision fixture agent.",
  extensions: [
    makeVisionExtension({
      // 只替换附件来源;`complete` 保持真实 completeSimple。
      getAttachmentCtx: () => fakeAttachmentCtx as never,
    }),
  ],
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
