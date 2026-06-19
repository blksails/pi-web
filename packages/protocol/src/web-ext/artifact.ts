/**
 * web-ext 契约 — Tier 4 artifact 隔离表面的 postMessage 消息(宿主 ↔ sandbox iframe)。
 *
 * iframe 处于独立 origin、`sandbox="allow-scripts"`,无同源 cookie/存储/DOM/凭证。
 * 宿主校验 `event.origin` 与本 schema,丢弃不符消息。artifact 经 `rpc` 中转回 agent。
 */
import { z } from "zod";
import { UiRpcRequestSchema } from "./ui-rpc.js";

/** artifact iframe → 宿主 / 宿主 → iframe 的消息联合(以 `kind` 判别)。 */
export const ArtifactMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), manifestId: z.string().min(1) }),
  z.object({ kind: z.literal("resize"), height: z.number().nonnegative() }),
  z.object({ kind: z.literal("rpc"), request: UiRpcRequestSchema }),
  z.object({
    kind: z.literal("event"),
    name: z.string().min(1),
    data: z.unknown(),
  }),
]);
export type ArtifactMessage = z.infer<typeof ArtifactMessageSchema>;

/** 安全解析:非法消息返回 undefined(由宿主丢弃)。 */
export function parseArtifactMessage(input: unknown): ArtifactMessage | undefined {
  const r = ArtifactMessageSchema.safeParse(input);
  return r.success ? r.data : undefined;
}
