export type PaneId = "files" | "editor" | "diff" | "canvas" | "artifact";
export type PaneInteractionMode = "standard" | "advanced";

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
