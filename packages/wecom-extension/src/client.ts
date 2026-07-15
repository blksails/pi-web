/**
 * Minimal HTTP client for pi-gateway channel binding + outbound APIs.
 */

import type { WecomGatewayConfig } from "./config.js";

export type DeliveryMode = "auto" | "passive" | "active";

export interface ChannelEndpoint {
  channelId: string;
  channelType: string;
  threadId: string;
  userId?: string;
  extras?: Record<string, string>;
}

export interface SessionChannelBinding {
  sessionId: string;
  origin: string;
  endpoint: ChannelEndpoint;
  agentSource?: string;
  allowActivePush: boolean;
  createdAt: string;
  replyReqId?: string;
}

export type OutboundKind = "text" | "file" | "template_card";

export interface OutboundFilePayload {
  path?: string;
  base64?: string;
  filename: string;
  mediaType?: "file" | "image" | "voice" | "video";
}

export interface OutboundIntent {
  sessionId?: string;
  endpoint?: ChannelEndpoint;
  text?: string;
  kind?: OutboundKind;
  file?: OutboundFilePayload;
  templateCard?: Record<string, unknown>;
  delivery?: DeliveryMode;
  replyReqId?: string;
  finish?: boolean;
  idempotencyKey?: string;
  cause?: string;
}

export type OutboundResult =
  | {
      ok: true;
      deliveryUsed: "passive" | "active";
      channelId: string;
      threadId: string;
      sessionId?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export interface GatewayHealth {
  status?: string;
  upstream?: { healthy?: boolean; agentSource?: string };
  channels?: Array<{ id: string; transport?: string; authenticated?: boolean }>;
  bindings?: { forward?: number; reverse?: number };
}

export type FetchLike = typeof fetch;

export class WecomGatewayClient {
  constructor(
    private readonly config: WecomGatewayConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["content-type"] = "application/json";
    if (this.config.token) h.authorization = `Bearer ${this.config.token}`;
    return h;
  }

  async health(): Promise<GatewayHealth> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/health`, {
      headers: this.headers(false),
    });
    if (!res.ok) {
      throw new Error(`gateway health ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as GatewayHealth;
  }

  async getBinding(sessionId: string): Promise<SessionChannelBinding | null> {
    const res = await this.fetchImpl(
      `${this.config.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/channel-binding`,
      { headers: this.headers(false) },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`get binding ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as SessionChannelBinding;
  }

  async outbound(intent: OutboundIntent): Promise<OutboundResult> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/outbound`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(intent),
    });
    const data = (await res.json()) as OutboundResult;
    return data;
  }
}
