export interface MaterialsInvalidation {
  readonly revision: number;
  readonly requestId: string;
}

type Listener = (event: MaterialsInvalidation) => void;

let revision = 0;
const listeners = new Set<Listener>();

/** 写成功后的进程内失效信号；不承载企业实体，只令 Pane 重查权威 BFF。 */
export function signalMaterialsInvalidation(requestId: string): MaterialsInvalidation {
  const event = { revision: ++revision, requestId };
  for (const listener of listeners) listener(event);
  return event;
}

export function subscribeMaterialsInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
