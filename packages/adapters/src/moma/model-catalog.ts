/** MOMA model catalog adapter. */
import type { CatalogModel } from "@blksails/pi-web-core/model-catalog/service.js";
import type { GatewayModelEntry } from "@blksails/pi-web-core/model-catalog/types.js";
import type { Modality } from "@blksails/pi-web-core/model-catalog/modality.js";
import {
  GatewayModelCatalog,
  type GatewayCatalogLogger,
} from "../ai-gateway/model-catalog.js";
import type { KeyResolver } from "../ai-gateway/key-resolver.js";
import type { MomaConfig } from "./config.js";

export const MOMA_PROVIDER_ID = "moma" as const;
export const MOMA_CHAT_MODEL_ID = "kimi/kimi-k3" as const;
export const MOMA_MINIMAX_H3_MODEL_ID = "minimax/minimax-h3" as const;
export const MOMA_SEEDANCE_MODEL_ID = "gdmz/doubao-seedance-2.0" as const;

/** Static fallback keeps the configured chat model selectable during first catalog refresh. */
export const MOMA_CHAT_MODEL_ENTRY: GatewayModelEntry = {
  model: MOMA_CHAT_MODEL_ID,
  name: "Kimi-K3",
  ownedBy: MOMA_PROVIDER_ID,
  source: "ai-gateway",
  instanceId: MOMA_PROVIDER_ID,
};

/**
 * MOMA's AIGC models are catalog entries, not chat registry entries. The node-only
 * media extension consumes their provider-specific async routes; the core text-session
 * registry must not pretend these video models are chat models.
 */
export const MOMA_AIGC_CATALOG: readonly CatalogModel[] = [
  {
    provider: MOMA_PROVIDER_ID,
    id: MOMA_MINIMAX_H3_MODEL_ID,
    name: "MiniMax-H3",
    input: ["text", "image", "video", "audio"] satisfies readonly Modality[],
    output: ["video"] satisfies readonly Modality[],
    source: MOMA_PROVIDER_ID,
    availability: "catalog",
  },
  {
    provider: MOMA_PROVIDER_ID,
    id: MOMA_SEEDANCE_MODEL_ID,
    name: "AICC-doubao-seedance-2.0",
    input: ["text", "image", "video", "audio"] satisfies readonly Modality[],
    output: ["video"] satisfies readonly Modality[],
    source: MOMA_PROVIDER_ID,
    availability: "catalog",
  },
];

export interface MomaModelCatalogDeps {
  readonly ttlMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly nowFn?: () => number;
  readonly logger?: GatewayCatalogLogger;
}

export interface MomaChatModelCatalog {
  get(): readonly GatewayModelEntry[];
  refresh(): Promise<void>;
}

class MomaChatCatalog implements MomaChatModelCatalog {
  constructor(private readonly remote: GatewayModelCatalog) {}

  get(): readonly GatewayModelEntry[] {
    const remote = this.remote.get();
    const named = remote.map((entry) =>
      entry.model === MOMA_CHAT_MODEL_ID
        ? { ...entry, name: "Kimi-K3", ownedBy: MOMA_PROVIDER_ID }
        : entry,
    );
    if (named.some((entry) => entry.model === MOMA_CHAT_MODEL_ID)) return named;
    return [MOMA_CHAT_MODEL_ENTRY, ...remote];
  }

  refresh(): Promise<void> {
    return this.remote.refresh();
  }
}

/** Build the MOMA Kimi catalog using the existing OpenAI-compatible gateway fetcher. */
export function createMomaModelCatalog(
  config: MomaConfig,
  deps: MomaModelCatalogDeps = {},
): MomaChatModelCatalog {
  const keyResolver: KeyResolver = { resolve: async () => config.apiKey };
  return new MomaChatCatalog(
    new GatewayModelCatalog({
      baseUrl: config.baseUrl,
      ttlMs: deps.ttlMs ?? 300_000,
      instanceId: MOMA_PROVIDER_ID,
      keyResolver,
      allowedModelIds: new Set([MOMA_CHAT_MODEL_ID]),
      input: ["text"],
      output: ["text"],
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.nowFn !== undefined ? { nowFn: deps.nowFn } : {}),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    }),
  );
}
