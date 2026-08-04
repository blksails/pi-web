import type { PaneCapabilities, PaneGuestRequest } from "./contract.js";
import { PaneHostError } from "./errors.js";

export const DEFAULT_PANE_REQUEST_BYTES = 256 * 1024;
export const DEFAULT_PANE_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PANE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function estimatePayloadBytes(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function authorizePaneRequest(capabilities: PaneCapabilities, request: PaneGuestRequest): void {
  if (request.operation === "route.query" || request.operation === "route.mutate") {
    const method = request.operation === "route.query" ? "GET" : "POST";
    const grant = capabilities.routes.find((candidate) => candidate.name === request.route && candidate.methods.includes(method));
    if (grant === undefined) throw new PaneHostError("CAPABILITY_DENIED", `${method} Agent Route ${request.route} is not granted`);
    const payload = request.operation === "route.query" ? request.query : request.body;
    if (estimatePayloadBytes(payload) > (grant.maxRequestBytes ?? DEFAULT_PANE_REQUEST_BYTES)) {
      throw new PaneHostError("PAYLOAD_TOO_LARGE", "Pane route request exceeds its grant limit");
    }
    return;
  }
  if (request.operation === "surface.run") {
    const allowed = capabilities.surfaceCommands.some((grant) =>
      grant.domain === request.domain && grant.actions.includes(request.action));
    if (!allowed) throw new PaneHostError("CAPABILITY_DENIED", `Surface ${request.domain}.${request.action} is not granted`);
    if (estimatePayloadBytes(request.args) > DEFAULT_PANE_REQUEST_BYTES) {
      throw new PaneHostError("PAYLOAD_TOO_LARGE", "Surface request exceeds the pane limit");
    }
    return;
  }
  if (request.operation === "event.publish") {
    if (!capabilities.events.publish.includes(request.topic)) {
      throw new PaneHostError("CAPABILITY_DENIED", `Pane event ${request.topic} is not granted`);
    }
    if (estimatePayloadBytes(request.payload) > DEFAULT_PANE_REQUEST_BYTES) {
      throw new PaneHostError("PAYLOAD_TOO_LARGE", "Pane event exceeds the pane limit");
    }
    return;
  }
  if (request.operation === "attachment.put") {
    if (capabilities.attachments !== "read-write") throw new PaneHostError("CAPABILITY_DENIED", "Attachment upload is not granted");
    if (request.bytes.byteLength > DEFAULT_PANE_ATTACHMENT_BYTES) {
      throw new PaneHostError("PAYLOAD_TOO_LARGE", "Attachment exceeds the pane limit");
    }
    return;
  }
  if (request.operation === "state.set" || request.operation === "state.delete") {
    // ★ 拒绝消息**刻意不含键名**(Req 2.6):带上它,调用方就能用「消息里回显了我传的键」
    // 与否来区分「未授权」和「键不存在」——那正是本条要堵的信息泄露。
    // 与 route 拒绝带 route 名不同:route 是 agent 自己声明的,共享状态的键则可能来自别处。
    if (!capabilities.state.write.includes(request.key)) {
      throw new PaneHostError("CAPABILITY_DENIED", "Pane shared state write is not granted");
    }
    if (request.operation === "state.set" && estimatePayloadBytes(request.value) > DEFAULT_PANE_REQUEST_BYTES) {
      throw new PaneHostError("PAYLOAD_TOO_LARGE", "Pane state write exceeds the pane limit");
    }
    return;
  }
  if (capabilities.conversation !== "submit") {
    throw new PaneHostError("CAPABILITY_DENIED", "Conversation submit is not granted");
  }
}
