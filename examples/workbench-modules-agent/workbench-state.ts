export type WorkbenchModuleId = "files" | "editor" | "diff" | "canvas";

export interface WorkbenchChange {
  readonly revision: number;
  readonly moduleId: WorkbenchModuleId;
  readonly summary: string;
}

export interface WorkbenchSnapshot {
  readonly revision: number;
  readonly files: ReadonlyArray<{ readonly path: string; readonly version: number }>;
  readonly canvas: {
    readonly shapeCount: number;
    readonly attachmentCount: number;
  };
  readonly changes: readonly WorkbenchChange[];
}

interface WorkbenchFile {
  readonly path: string;
  readonly content: string;
  readonly baseline: string;
  readonly version: number;
}

interface CanvasShape {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

interface CanvasAttachment {
  readonly attachmentId: string;
  readonly name: string;
}

interface WorkbenchState {
  revision: number;
  files: WorkbenchFile[];
  shapes: CanvasShape[];
  attachments: CanvasAttachment[];
  changes: WorkbenchChange[];
}

const INITIAL_FILES: readonly WorkbenchFile[] = [
  {
    path: "README.md",
    content: "# Workbench modules\n\n每个标签页运行在独立 iframe 中。\n",
    baseline: "# Workbench modules\n\n每个标签页运行在独立 iframe 中。\n",
    version: 1,
  },
  {
    path: "src/main.ts",
    content: 'export const greeting = "hello workbench";\n',
    baseline: 'export const greeting = "hello workbench";\n',
    version: 1,
  },
];

function initialState(): WorkbenchState {
  return {
    revision: 0,
    files: INITIAL_FILES.map((file) => ({ ...file })),
    shapes: [],
    attachments: [],
    changes: [],
  };
}

let state = initialState();
let publish: ((snapshot: WorkbenchSnapshot) => void) | undefined;

function snapshot(): WorkbenchSnapshot {
  return {
    revision: state.revision,
    files: state.files.map(({ path, version }) => ({ path, version })),
    canvas: {
      shapeCount: state.shapes.length,
      attachmentCount: state.attachments.length,
    },
    changes: state.changes.slice(-8),
  };
}

function record(moduleId: WorkbenchModuleId, summary: string): void {
  state.revision += 1;
  state.changes.push({ revision: state.revision, moduleId, summary });
  if (state.changes.length > 32) state.changes = state.changes.slice(-32);
  publish?.(snapshot());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asModuleId(value: unknown): WorkbenchModuleId | undefined {
  return value === "files" || value === "editor" || value === "diff" || value === "canvas"
    ? value
    : undefined;
}

function checkRevision(value: unknown): { ok: true } | { ok: false; error: string } {
  if (value === undefined || value === state.revision) return { ok: true };
  return { ok: false, error: `revision conflict: expected ${String(value)}, current ${state.revision}` };
}

export function getWorkbenchSnapshot(): WorkbenchSnapshot {
  return snapshot();
}

export function setWorkbenchPublisher(next: (value: WorkbenchSnapshot) => void): () => void {
  publish = next;
  next(snapshot());
  return () => {
    if (publish === next) publish = undefined;
  };
}

export function readWorkbenchModule(
  moduleId: WorkbenchModuleId,
  query: Readonly<Record<string, string>> = {},
): unknown {
  if (moduleId === "files") {
    return { revision: state.revision, files: snapshot().files };
  }
  if (moduleId === "editor") {
    const requested = query["path"];
    const file = state.files.find((item) => item.path === requested) ?? state.files[0];
    return {
      revision: state.revision,
      files: state.files.map(({ path }) => path),
      file: file === undefined ? null : { path: file.path, content: file.content, version: file.version },
    };
  }
  if (moduleId === "diff") {
    return {
      revision: state.revision,
      files: state.files
        .filter((file) => file.content !== file.baseline)
        .map((file) => ({ path: file.path, before: file.baseline, after: file.content })),
    };
  }
  return {
    revision: state.revision,
    shapes: state.shapes.map((shape) => ({ ...shape })),
    attachments: state.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function mutateWorkbench(body: unknown): unknown {
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const moduleId = asModuleId(body["moduleId"]);
  const operation = body["operation"];
  const payload = body["payload"];
  if (moduleId === undefined || typeof operation !== "string" || !isRecord(payload)) {
    return { ok: false, error: "moduleId, operation and payload are required" };
  }
  const revision = checkRevision(body["expectedRevision"]);
  if (!revision.ok) return { ok: false, error: revision.error, revision: state.revision };

  if (operation === "add-file" && moduleId === "files") {
    const path = payload["path"];
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) ||
      path.includes("..") ||
      path.includes("//")
    ) {
      return { ok: false, error: "path must be a safe non-empty string" };
    }
    if (state.files.length >= 64) return { ok: false, error: "file limit reached" };
    if (state.files.some((file) => file.path === path)) return { ok: false, error: "file already exists" };
    state.files.push({ path, content: "", baseline: "", version: 1 });
    record(moduleId, `created ${path}`);
    return { ok: true, revision: state.revision };
  }

  if (operation === "write-file" && moduleId === "editor") {
    const path = payload["path"];
    const content = payload["content"];
    if (typeof path !== "string" || typeof content !== "string" || content.length > 100_000) {
      return { ok: false, error: "path/content invalid or content exceeds 100 KiB" };
    }
    const index = state.files.findIndex((file) => file.path === path);
    if (index < 0) return { ok: false, error: "file not found" };
    const previous = state.files[index]!;
    state.files[index] = { ...previous, content, version: previous.version + 1 };
    record(moduleId, `updated ${path}`);
    return { ok: true, revision: state.revision, version: previous.version + 1 };
  }

  if (operation === "add-shape" && moduleId === "canvas") {
    const x = payload["x"];
    const y = payload["y"];
    const color = payload["color"];
    if (typeof x !== "number" || typeof y !== "number" || typeof color !== "string") {
      return { ok: false, error: "x, y and color are required" };
    }
    state.shapes.push({ id: `shape-${state.revision + 1}`, x, y, color });
    record(moduleId, "added a canvas shape");
    return { ok: true, revision: state.revision };
  }

  if (operation === "clear-canvas" && moduleId === "canvas") {
    state.shapes = [];
    record(moduleId, "cleared canvas shapes");
    return { ok: true, revision: state.revision };
  }

  if (operation === "link-attachment" && moduleId === "canvas") {
    const attachmentId = payload["attachmentId"];
    const name = payload["name"];
    if (typeof attachmentId !== "string" || !attachmentId.startsWith("att_") || typeof name !== "string") {
      return { ok: false, error: "valid attachmentId and name are required" };
    }
    state.attachments.push({ attachmentId, name });
    record(moduleId, `attached ${name} as ${attachmentId}`);
    return { ok: true, revision: state.revision };
  }

  return { ok: false, error: "operation is not allowed for this module" };
}

export function inspectWorkbenchForLlm(path?: string): unknown {
  const requested = path === undefined ? undefined : state.files.find((file) => file.path === path);
  return {
    revision: state.revision,
    files: state.files.map(({ path: filePath, content, version }) => ({
      path: filePath,
      version,
      preview: path === undefined ? content.slice(0, 2_000) : undefined,
      truncated: path === undefined && content.length > 2_000,
    })),
    ...(path !== undefined
      ? { requestedFile: requested === undefined ? null : { path: requested.path, content: requested.content, version: requested.version } }
      : {}),
    canvas: {
      shapes: state.shapes.map((shape) => ({ ...shape })),
      attachments: state.attachments.map((attachment) => ({ ...attachment })),
    },
    recentChanges: state.changes.slice(-8),
  };
}

export function resetWorkbenchForTests(): void {
  state = initialState();
  publish?.(snapshot());
}
