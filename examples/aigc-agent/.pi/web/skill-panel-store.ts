/**
 * skill 面板开合的 module-level store(同一 app bundle 内 launcher 与 panel 共享),
 * 仿 canvas 的 canvasOpenStore。用 useSyncExternalStore 订阅。
 */
import * as React from "react";

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function toggleSkillPanel(): void {
  open = !open;
  emit();
}

export function setSkillPanelOpen(next: boolean): void {
  open = next;
  emit();
}

export function useSkillPanelOpen(): boolean {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => open,
  );
}
