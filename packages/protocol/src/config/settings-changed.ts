/**
 * per-source settings 运行期实时下发契约(spec source-settings-and-slots,任务 7.2;
 * design.md「地基 G1」通道 b;Requirement 7)。
 *
 * `PUT /config/source/:sourceKey` 落盘成功后,服务端经 SSE `control:"settings-changed"`
 * 帧广播给该 source 对应的活跃会话订阅者(复用 `piweb_state`/`session-state` 的「广播 +
 * sticky 粘性回放」模式,克隆而非新增机制,见 pi-session.ts 的 `emitSettingsChanged`)。
 *
 * - `values`:已按既有 secret 掩码规则处理(明文永不下发浏览器,同
 *   `GET /config/source/:sourceKey`),全量携带(与磁盘落盘后的完整快照一致)。
 * - `liveReloadKeys`:schema 中标记 `liveReload:true` 的字段 key 子集(Req 7.1)。消费侧
 *   只应用该子集实时生效;其余键随帧携带但仍需下次装配(新会话)才生效——由消费侧自行
 *   过滤,契约本身不做取舍。
 *
 * 并入 `transport/sse-frame.ts` 的 `ControlPayloadSchema` 判别联合。
 */
import { z } from "zod";

export const SettingsChangedControlPayloadSchema = z.object({
  control: z.literal("settings-changed"),
  /** 触发本次下发的 source(sourceKey,与端点路径段一致)。 */
  sourceKey: z.string().min(1),
  /** 落盘后的完整值快照(secret 已掩码)。 */
  values: z.record(z.unknown()),
  /** schema 声明 `liveReload:true` 的字段 key 子集(可为空数组)。 */
  liveReloadKeys: z.array(z.string()),
});
export type SettingsChangedControlPayload = z.infer<
  typeof SettingsChangedControlPayloadSchema
>;
