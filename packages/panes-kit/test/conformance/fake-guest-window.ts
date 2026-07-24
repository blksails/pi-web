/**
 * Guest Realm 的最小 window 伪造:pane WebView 内 `parent === window`,postMessage
 * 异步派发且可携带 MessagePort——`connectPaneGuest` 与 Guest Realm 引导共用此面。
 */
export interface FakeMessageEvent {
  readonly data: unknown;
  readonly source: unknown;
  readonly ports: readonly MessagePort[];
}

type MessageListener = (event: FakeMessageEvent) => void;

export class FakeGuestWindow {
  readonly parent = this;
  private readonly listeners = new Set<MessageListener>();

  addEventListener(type: string, listener: unknown): void {
    if (type === "message") this.listeners.add(listener as MessageListener);
  }

  removeEventListener(type: string, listener: unknown): void {
    if (type === "message") this.listeners.delete(listener as MessageListener);
  }

  postMessage(data: unknown, _targetOrigin?: unknown, transfer: readonly MessagePort[] = []): void {
    queueMicrotask(() => {
      const event: FakeMessageEvent = { data, source: this, ports: transfer };
      for (const listener of [...this.listeners]) listener(event);
    });
  }

  asWindow(): Window {
    return this as unknown as Window;
  }
}
