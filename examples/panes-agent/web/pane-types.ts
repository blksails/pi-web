export type PaneId = "files" | "editor" | "diff" | "canvas" | "artifact";
export type PaneInteractionMode = "standard" | "advanced";

export interface PanesHostConfig {
  readonly interactionMode: PaneInteractionMode;
  readonly allowTabReorder: boolean;
  readonly showCommandPalette: boolean;
}

export interface PaneDefinition {
  readonly id: PaneId;
  readonly title: string;
  readonly icon: string;
  readonly document: string;
  readonly capabilities: {
    readonly write?: boolean;
    readonly attachments?: boolean;
  };
}

export interface PanesSnapshot {
  readonly revision: number;
  readonly files: ReadonlyArray<{ readonly path: string; readonly version: number }>;
  readonly canvas: { readonly shapeCount: number; readonly attachmentCount: number };
  readonly artifacts: { readonly count: number; readonly publishedCount: number };
  readonly changes: ReadonlyArray<{
    readonly revision: number;
    readonly paneId: PaneId;
    readonly summary: string;
  }>;
}

export interface PaneRequest {
  readonly type: "request";
  readonly id: string;
  readonly operation: "query" | "mutate" | "attach";
  readonly payload?: unknown;
}
