/**
 * attachment-bridge · 真实子进程 fixture(attachment-backend-pluggable spec,任务 7.2)。
 *
 * 独立可执行脚本(经 `--import jiti/register` 以 TS 源码直跑,与既有 runner 真实子进程测试同一
 * 技术:见 `test/runner/canvas-surface.integration.test.ts`)。模拟 agent 工具在子进程内经
 * `createChildAttachmentStore(process.env)` 落库一个 `tool-output` 附件——不牵涉 LLM/runner
 * 装配,只验证「子进程按 spawn env 重建同构存储视图 → 落库」这一段真实进程边界(Req 6.1/6.2/6.3)。
 *
 * 输出协议:唯一一行 JSON 到 stdout:
 *   - 能力不可用(env 未下发)→ `{"available":false}`;
 *   - 落库成功 → `{"available":true,"id":"att_…","backend":"…" | null}`。
 */
import { createChildAttachmentStore } from "../../../src/attachment-bridge/child-store.js";

async function main(): Promise<void> {
  const store = createChildAttachmentStore(process.env);
  if (store === undefined) {
    process.stdout.write(JSON.stringify({ available: false }) + "\n");
    return;
  }
  const att = await store.put({
    bytes: new Uint8Array([1, 2, 3, 4]),
    name: "child-out.bin",
    mimeType: "application/octet-stream",
    size: 4,
    sessionId: process.env["TEST_SESSION_ID"] ?? "sess-real-subprocess",
    origin: "tool-output",
  });
  process.stdout.write(
    JSON.stringify({ available: true, id: att.id, backend: att.backend ?? null }) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + "\n");
  process.exitCode = 1;
});
