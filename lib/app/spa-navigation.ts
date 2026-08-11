/** Navigate inside the existing document so session-owned native panes survive. */
export interface SpaNavigationClickEvent {
  readonly defaultPrevented: boolean;
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
}

export function navigateSpa(
  event: SpaNavigationClickEvent,
  path: string,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    typeof window === "undefined"
  ) {
    return;
  }
  event.preventDefault();
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
