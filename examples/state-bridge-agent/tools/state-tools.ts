/**
 * state-bridge-agent · 示例状态工具(state-injection-bridge)。
 *
 * 演示作者工具经 pi-web 自建的会话级共享状态核(context 外)读写:
 *  - `increment`:读 `count`、+1 写回、返回新值 —— 写入经下行帧实时镜像到 UI。
 *  - `read_state`:读某 key(或全量快照)当前值。
 *
 * 状态接入点由 runner 的 `wireStateBridge` 挂到约定 globalThis seam;本工具直接读该 seam(与
 * attachment 示例同款自包含范式,避免对 server 包的值依赖)。seam 缺失时安全降级、不崩溃。
 */
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** 约定 seam key(与 server `wireStateBridge` / tool-kit `SESSION_STATE_SEAM_KEY` 一致)。 */
const SESSION_STATE_SEAM_KEY = "__piWebSessionState__";

interface SeamProvider {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

function getSeam(): SeamProvider | undefined {
  const p = (globalThis as Record<string, unknown>)[SESSION_STATE_SEAM_KEY];
  if (
    p &&
    typeof p === "object" &&
    typeof (p as { get?: unknown }).get === "function" &&
    typeof (p as { set?: unknown }).set === "function"
  ) {
    return p as SeamProvider;
  }
  return undefined;
}

const IncrementParameters = Type.Object({
  key: Type.Optional(
    Type.String({ description: "状态 key(默认 'count')。" }),
  ),
});

/** increment:读 key、+1 写回、返回新值。写入经下行帧实时镜像到 UI。 */
export const incrementTool: ToolDefinition<typeof IncrementParameters> =
  defineTool({
    name: "increment",
    label: "Increment State",
    description:
      "Increment a shared-state counter by 1 and return the new value. " +
      "The value is mirrored to the UI in real time (state lives outside the LLM context).",
    parameters: IncrementParameters,
    async execute(_toolCallId, params) {
      const seam = getSeam();
      if (seam === undefined) {
        return {
          content: [{ type: "text", text: "Shared state capability unavailable." }],
          details: { ok: false, error: "state capability unavailable" },
        };
      }
      const key = params.key ?? "count";
      const prev = typeof seam.get(key) === "number" ? (seam.get(key) as number) : 0;
      const next = prev + 1;
      seam.set(key, next);
      return {
        content: [{ type: "text", text: `${key} = ${next}` }],
        details: { ok: true, key, value: next },
      };
    },
  });

const ReadStateParameters = Type.Object({
  key: Type.Optional(
    Type.String({ description: "要读的状态 key;省略则返回全量快照。" }),
  ),
});

/** read_state:读某 key(或全量快照)当前值。 */
export const readStateTool: ToolDefinition<typeof ReadStateParameters> =
  defineTool({
    name: "read_state",
    label: "Read State",
    description: "Read the current value of a shared-state key (or the full snapshot).",
    parameters: ReadStateParameters,
    async execute(_toolCallId, params) {
      const seam = getSeam();
      if (seam === undefined) {
        return {
          content: [{ type: "text", text: "Shared state capability unavailable." }],
          details: { ok: false, error: "state capability unavailable" },
        };
      }
      const value =
        params.key !== undefined ? seam.get(params.key) : seam.snapshot();
      return {
        content: [{ type: "text", text: JSON.stringify(value ?? null) }],
        details: { ok: true, value },
      };
    },
  });
