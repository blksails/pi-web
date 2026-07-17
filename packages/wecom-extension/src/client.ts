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

  /** Channel-admin: identity from session binding on gateway. */
  async adminWhoami(sessionId: string): Promise<AdminWhoamiResult> {
    const res = await this.fetchImpl(
      `${this.config.baseUrl}/api/admin/whoami?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: this.headers(false) },
    );
    return (await res.json()) as AdminWhoamiResult;
  }

  async adminList(sessionId: string, channelType = "wecom"): Promise<AdminListResult> {
    const q = new URLSearchParams({ sessionId, channelType });
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/admin/list?${q}`, {
      headers: this.headers(false),
    });
    return (await res.json()) as AdminListResult;
  }

  async adminGrant(input: {
    sessionId: string;
    userId: string;
    channelType?: string;
  }): Promise<AdminMutateResult> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/admin/grant`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        sessionId: input.sessionId,
        userId: input.userId,
        channelType: input.channelType ?? "wecom",
      }),
    });
    return (await res.json()) as AdminMutateResult;
  }

  async adminRevoke(input: {
    sessionId: string;
    userId: string;
    channelType?: string;
  }): Promise<AdminMutateResult> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/admin/revoke`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        sessionId: input.sessionId,
        userId: input.userId,
        channelType: input.channelType ?? "wecom",
      }),
    });
    return (await res.json()) as AdminMutateResult;
  }

  async adminStatus(sessionId: string): Promise<AdminStatusResult> {
    const res = await this.fetchImpl(
      `${this.config.baseUrl}/api/admin/status?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: this.headers(false) },
    );
    return (await res.json()) as AdminStatusResult;
  }
}

export type AdminWhoamiResult =
  | {
      ok: true;
      userId: string;
      channelType: string;
      role: "admin" | "user";
      sessionId?: string;
      source?: string | null;
    }
  | { ok?: false; code: string; message: string };

export type AdminListResult =
  | {
      ok: true;
      channelType: string;
      admins: Array<{ userId: string; source: string; channelType?: string }>;
    }
  | { ok?: false; code: string; message: string };

export type AdminMutateResult =
  | { ok: true; code?: string; userId?: string; channelType?: string }
  | { ok: false; code: string; message: string };

export type AdminStatusResult =
  | {
      ok: true;
      version?: string;
      upstream?: { kind?: string; healthy?: boolean };
      channels?: unknown[];
      bindings?: { forward?: number; reverse?: number };
    }
  | { ok?: false; code: string; message: string };
