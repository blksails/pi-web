/**
 * completion-provider-framework — 服务端 provider 注册表。
 *
 * 职责:注册(校验单字符触发符、同 id 覆盖告警)、活跃触发符并集、按归一化触发符
 * 并发分发 complete(per-provider 超时降级)、合并结果、按 kind 查 provider 供提交期 resolve。
 */
import type {
  CompletionItem,
  CompletionResponse,
  CompletionTriggerSpec,
  CompletionExtractRule,
} from "@blksails/pi-web-protocol";
import type { CompletionCtx, CompletionProvider } from "./types.js";
import { providerKind } from "./types.js";
import { normalizeTrigger } from "./normalize.js";
import { mergeCompletions } from "./merge.js";
import { createLogger } from "@blksails/pi-web-logger";
import type { Sink } from "@blksails/pi-web-logger";

/** 注册表可调参数(均有保守默认)。 */
export interface CompletionRegistryOptions {
  /** 单 provider complete 超时(ms),超时按空结果降级。 */
  readonly providerTimeoutMs?: number;
  /** 合并后候选总量上限。 */
  readonly limit?: number;
  /**
   * 告警钩子(可注入覆盖,向后兼容);若提供则优先使用覆盖而非默认 logger。
   * 默认经 createLogger({ namespace: "core:completion" }).warn 产出。
   */
  readonly onWarn?: (message: string) => void;
  /**
   * 注入 logger 的 sink(仅测试用);未注入时使用默认 sink (node: stderr / browser: bus)。
   */
  readonly loggerSink?: Sink;
}

const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_LIMIT = 30;

export interface CompletionRegistry {
  register(provider: CompletionProvider): void;
  /** 已注册 provider 触发符并集 + 提取规则。 */
  triggers(): readonly CompletionTriggerSpec[];
  /** 按(可为等价形态的)触发符查询候选。 */
  query(
    rawTrigger: string,
    query: string,
    ctx: CompletionCtx,
  ): Promise<CompletionResponse>;
  /** 按 kind 取 provider(供提交期 resolve 分发)。 */
  findByKind(kind: string): CompletionProvider | undefined;
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    p.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

export function createCompletionRegistry(
  opts: CompletionRegistryOptions = {},
): CompletionRegistry {
  const timeoutMs = opts.providerTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const _logger = createLogger({
    namespace: "core:completion",
    ...(opts.loggerSink !== undefined ? { sink: opts.loggerSink } : {}),
  });
  const warn =
    opts.onWarn !== undefined
      ? opts.onWarn
      : (m: string) => _logger.warn(m);

  const byId = new Map<string, CompletionProvider>();

  return {
    register(provider): void {
      if ([...provider.trigger].length !== 1) {
        throw new Error(
          `CompletionProvider "${provider.id}" trigger must be a single character, got ${JSON.stringify(provider.trigger)}`,
        );
      }
      if (byId.has(provider.id)) {
        warn(
          `CompletionProvider id "${provider.id}" already registered; overwriting.`,
        );
      }
      byId.set(provider.id, provider);
    },

    triggers(): readonly CompletionTriggerSpec[] {
      const map = new Map<string, CompletionExtractRule>();
      for (const p of byId.values()) {
        const trigger = normalizeTrigger(p.trigger);
        if (!map.has(trigger)) {
          map.set(trigger, p.extract ?? "wordTail");
        }
      }
      return [...map.entries()].map(([trigger, extract]) => ({
        trigger,
        extract,
      }));
    },

    async query(rawTrigger, query, ctx): Promise<CompletionResponse> {
      const trigger = normalizeTrigger(rawTrigger);
      const matched = [...byId.values()].filter(
        (p) => normalizeTrigger(p.trigger) === trigger,
      );
      if (matched.length === 0) return { items: [], groups: [] };

      const settled = await Promise.all(
        matched.map(async (provider) => {
          const items = await withTimeout<readonly CompletionItem[]>(
            Promise.resolve().then(() => provider.complete({ query, ctx })),
            timeoutMs,
            [],
          );
          return { provider, items };
        }),
      );
      return mergeCompletions(settled, { limit });
    },

    findByKind(kind): CompletionProvider | undefined {
      for (const p of byId.values()) {
        if (providerKind(p) === kind) return p;
      }
      return undefined;
    },
  };
}
