/**
 * per-source settings 运行期实时下发 — PUT→活跃会话广播桥(spec source-settings-and-slots,
 * 任务 7.2;design.md「通道 b」;Requirement 7)。
 *
 * `PUT /config/source/:sourceKey` 落盘成功(`source-settings-routes.ts`)后,应用层需要把
 * `piweb_settings_changed`(`control:"settings-changed"`)帧推给该 source 对应的**活跃会话**
 * (`PiSession.emitSettingsChanged`)。本模块承担「按 sourceKey 找到匹配会话」这一段:
 *
 * `SessionStore`(`session-store.ts`)只登记 `PiSession` 实例,不记录其对应哪个 sourceKey
 * ——`PiSession.policySource`(= `ResolvedSource.policySource`)是 resolver 稳定来源标识
 * (dir 绝对路径 / git url / `builtin:<name>`),与 HTTP 端点 URL 里的 `sourceKey` 不是
 * 同一形状,需要与装配期注入(`runner/source-settings-assembly-wiring.ts`)、HTTP 端点
 * (`config/source-settings-routes.ts` 的 `resolveSourceSettingsFromPackageDirs`)完全一致
 * 的匹配逻辑才能对同一 source 解析出同一 sourceKey(拍板 Q2)——对 dir 型 source,
 * `policySource === packageDir`(见 `agent-source/resolver.ts` 的 `toLocalDir`),故复用
 * `resolvePackageDir`(是目录则直接用,是文件则取父目录)+ `resolvePiPlugin` + `sourceKey`
 * 三段与既有两处完全同构。
 *
 * best-effort:单个会话解析失败(source 已不在磁盘、非 dir 型 source 等)一律跳过,不影响
 * PUT 本身的成功响应(Req 7.1 的 `MAY` 语义——下发失败不阻塞落盘)。
 */
import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { resolvePiPlugin } from "../plugin/resolve-plugin.js";
import { sourceKey as deriveSourceKey } from "../source-key.js";
import type { PiSession } from "./pi-session.js";
import type { SessionStore } from "./session-store.js";

/** 同 `runner/source-settings-assembly-wiring.ts` 的 `resolvePackageDir`(职责单一,值得内联
 * 而非跨 server/runner 边界共享——两处均是各自模块内的最小私有工具)。 */
function resolvePackageDir(policySource: string): string {
  try {
    if (existsSync(policySource) && statSync(policySource).isDirectory()) {
      return policySource;
    }
  } catch {
    // 探测失败(权限/竞态等)→ 按文件路径回退。
  }
  return dirname(policySource);
}

/**
 * 给定一个会话,best-effort 解析出它所属 source 的 sourceKey;`policySource` 缺失/空
 * 返回 `undefined`。注意 `resolvePiPlugin` 对清单缺失/非法有 basename 兜底(不会抛错),
 * 故指向不存在目录的 `policySource` 通常也能算出一个 sourceKey——只是不会与任何真实
 * source 的 sourceKey 相同,不构成误配风险(HTTP 端点的 `sourceKeyValue` 恒来自真实
 * 已落盘/已声明 source 的 URL 段)。`try/catch` 仅兜底 `sourceKey()` 对全空白 id 的
 * `TypeError`(理论边界,如 packageDir 为 "/"、basename 为空)。
 */
export async function resolveSessionSourceKey(
  session: PiSession,
): Promise<string | undefined> {
  const policySource = session.policySource;
  if (policySource === undefined || policySource.length === 0) return undefined;
  const packageDir = resolvePackageDir(policySource);
  try {
    const descriptor = await resolvePiPlugin(packageDir);
    return deriveSourceKey(descriptor.id);
  } catch {
    return undefined;
  }
}

/**
 * 遍历 store 中全部会话,把匹配 `sourceKeyValue` 的活跃会话逐一推 settings-changed 帧。
 * 单个会话匹配/广播失败被隔离(best-effort,不使整体调用失败)。
 */
export async function broadcastSettingsChanged(
  store: SessionStore,
  sourceKeyValue: string,
  payload: {
    readonly values: Readonly<Record<string, unknown>>;
    readonly liveReloadKeys: readonly string[];
  },
): Promise<void> {
  const sessions = store.list();
  await Promise.all(
    sessions.map(async (session) => {
      try {
        const key = await resolveSessionSourceKey(session);
        if (key !== sourceKeyValue) return;
        session.emitSettingsChanged({
          sourceKey: sourceKeyValue,
          values: payload.values,
          liveReloadKeys: payload.liveReloadKeys,
        });
      } catch {
        // 单会话失败隔离(fs 竞态/清单突变等),不影响其余会话广播。
      }
    }),
  );
}
