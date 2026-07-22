export type WorkbenchModuleId = "files" | "editor" | "diff" | "canvas";

export interface WorkbenchModule {
  readonly id: WorkbenchModuleId;
  readonly title: string;
  readonly icon: string;
  readonly document: string;
  readonly capabilities: {
    readonly write?: boolean;
    readonly attachments?: boolean;
  };
}

export interface WorkbenchSnapshot {
  readonly revision: number;
  readonly files: ReadonlyArray<{ readonly path: string; readonly version: number }>;
  readonly canvas: { readonly shapeCount: number; readonly attachmentCount: number };
  readonly changes: ReadonlyArray<{
    readonly revision: number;
    readonly moduleId: WorkbenchModuleId;
    readonly summary: string;
  }>;
}
