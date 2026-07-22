export type PaneId = "files" | "editor" | "diff" | "canvas" | "artifact";

export interface PaneChange {
  readonly revision: number;
  readonly paneId: PaneId;
  readonly summary: string;
}

export interface PanesSnapshot {
  readonly revision: number;
  readonly files: ReadonlyArray<{ readonly path: string; readonly version: number }>;
  readonly canvas: {
    readonly shapeCount: number;
    readonly attachmentCount: number;
  };
  readonly artifacts: {
    readonly count: number;
    readonly publishedCount: number;
  };
  readonly changes: readonly PaneChange[];
}

interface ProjectFile {
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
  readonly kind: "circle" | "rect";
}

interface CanvasAttachment {
  readonly attachmentId: string;
  readonly name: string;
}

type ArtifactStatus = "draft" | "review" | "published";

interface ArtifactItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: ArtifactStatus;
  readonly updatedAt: string;
}

interface PanesState {
  revision: number;
  files: ProjectFile[];
  shapes: CanvasShape[];
  attachments: CanvasAttachment[];
  artifacts: ArtifactItem[];
  changes: PaneChange[];
}

const INITIAL_FILES: readonly ProjectFile[] = [
  {
    path: "README.md",
    content: "# Panes\n\n每个标签页运行在独立 iframe 中。\n",
    baseline: "# Panes\n\n每个标签页运行在独立 iframe 中。\n",
    version: 1,
  },
  {
    path: "src/main.ts",
    content: 'export const greeting = "hello panes";\n',
    baseline: 'export const greeting = "hello panes";\n',
    version: 1,
  },
];

function initialState(): PanesState {
  return {
    revision: 0,
    files: INITIAL_FILES.map((file) => ({ ...file })),
    shapes: [],
    attachments: [],
    artifacts: [
      {
        id: "artifact-welcome",
        title: "独立 Pane 交付说明",
        body: "这个 Artifact 与其他 Pane 一样运行在无同源权限的 sandbox iframe 中。",
        status: "draft",
        updatedAt: "初始版本",
      },
    ],
    changes: [],
  };
}

let state = initialState();
let publish: ((snapshot: PanesSnapshot) => void) | undefined;

function snapshot(): PanesSnapshot {
  return {
    revision: state.revision,
    files: state.files.map(({ path, version }) => ({ path, version })),
    canvas: {
      shapeCount: state.shapes.length,
      attachmentCount: state.attachments.length,
    },
    artifacts: {
      count: state.artifacts.length,
      publishedCount: state.artifacts.filter((item) => item.status === "published").length,
    },
    changes: state.changes.slice(-8),
  };
}

function record(paneId: PaneId, summary: string): void {
  state.revision += 1;
  state.changes.push({ revision: state.revision, paneId, summary });
  if (state.changes.length > 32) state.changes = state.changes.slice(-32);
  publish?.(snapshot());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPaneId(value: unknown): PaneId | undefined {
  return value === "files" || value === "editor" || value === "diff" || value === "canvas" || value === "artifact"
    ? value
    : undefined;
}

function checkRevision(value: unknown): { ok: true } | { ok: false; error: string } {
  if (value === undefined || value === state.revision) return { ok: true };
  return { ok: false, error: `revision conflict: expected ${String(value)}, current ${state.revision}` };
}

export function getPanesSnapshot(): PanesSnapshot {
  return snapshot();
}

export function setPanesPublisher(next: (value: PanesSnapshot) => void): () => void {
  publish = next;
  next(snapshot());
  return () => {
    if (publish === next) publish = undefined;
  };
}

export function readPane(
  paneId: PaneId,
  query: Readonly<Record<string, string>> = {},
): unknown {
  if (paneId === "files") {
    return { revision: state.revision, files: snapshot().files };
  }
  if (paneId === "editor") {
    const requested = query["path"];
    const file = state.files.find((item) => item.path === requested) ?? state.files[0];
    return {
      revision: state.revision,
      files: state.files.map(({ path }) => path),
      file: file === undefined ? null : { path: file.path, content: file.content, version: file.version },
    };
  }
  if (paneId === "diff") {
    return {
      revision: state.revision,
      files: state.files
        .filter((file) => file.content !== file.baseline)
        .map((file) => ({ path: file.path, before: file.baseline, after: file.content })),
    };
  }
  if (paneId === "canvas") {
    return {
      revision: state.revision,
      shapes: state.shapes.map((shape) => ({ ...shape })),
      attachments: state.attachments.map((attachment) => ({ ...attachment })),
    };
  }
  return {
    revision: state.revision,
    artifacts: state.artifacts.map((artifact) => ({ ...artifact })),
  };
}

export function mutatePanes(body: unknown): unknown {
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  const paneId = asPaneId(body["paneId"]);
  const operation = body["operation"];
  const payload = body["payload"];
  if (paneId === undefined || typeof operation !== "string" || !isRecord(payload)) {
    return { ok: false, error: "paneId, operation and payload are required" };
  }
  const revision = checkRevision(body["expectedRevision"]);
  if (!revision.ok) return { ok: false, error: revision.error, revision: state.revision };

  if (operation === "add-file" && paneId === "files") {
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
    record(paneId, `created ${path}`);
    return { ok: true, revision: state.revision };
  }

  if (operation === "write-file" && paneId === "editor") {
    const path = payload["path"];
    const content = payload["content"];
    if (typeof path !== "string" || typeof content !== "string" || content.length > 100_000) {
      return { ok: false, error: "path/content invalid or content exceeds 100 KiB" };
    }
    const index = state.files.findIndex((file) => file.path === path);
    if (index < 0) return { ok: false, error: "file not found" };
    const previous = state.files[index]!;
    state.files[index] = { ...previous, content, version: previous.version + 1 };
    record(paneId, `updated ${path}`);
    return { ok: true, revision: state.revision, version: previous.version + 1 };
  }

  if (operation === "add-shape" && paneId === "canvas") {
    const x = payload["x"];
    const y = payload["y"];
    const color = payload["color"];
    const kind = payload["kind"];
    if (typeof x !== "number" || typeof y !== "number" || typeof color !== "string" || (kind !== "circle" && kind !== "rect")) {
      return { ok: false, error: "x, y, color and a supported kind are required" };
    }
    state.shapes.push({ id: `shape-${state.revision + 1}`, x, y, color, kind });
    record(paneId, "added a canvas shape");
    return { ok: true, revision: state.revision };
  }

  if (operation === "clear-canvas" && paneId === "canvas") {
    state.shapes = [];
    record(paneId, "cleared canvas shapes");
    return { ok: true, revision: state.revision };
  }

  if (operation === "link-attachment" && paneId === "canvas") {
    const attachmentId = payload["attachmentId"];
    const name = payload["name"];
    if (typeof attachmentId !== "string" || !attachmentId.startsWith("att_") || typeof name !== "string") {
      return { ok: false, error: "valid attachmentId and name are required" };
    }
    state.attachments.push({ attachmentId, name });
    record(paneId, `attached ${name} as ${attachmentId}`);
    return { ok: true, revision: state.revision };
  }

  if (operation === "create-artifact" && paneId === "artifact") {
    const title = payload["title"];
    const bodyText = payload["body"];
    if (typeof title !== "string" || title.trim().length === 0 || title.length > 120 || typeof bodyText !== "string" || bodyText.trim().length === 0 || bodyText.length > 20_000) {
      return { ok: false, error: "artifact title/body are required and exceed no limits" };
    }
    const artifactId = `artifact-${state.revision + 1}`;
    state.artifacts.unshift({ id: artifactId, title: title.trim(), body: bodyText, status: "draft", updatedAt: new Date().toISOString() });
    record(paneId, `created artifact ${title.trim()}`);
    return { ok: true, revision: state.revision, artifactId };
  }

  if (operation === "set-artifact-status" && paneId === "artifact") {
    const artifactId = payload["artifactId"];
    const status = payload["status"];
    if (typeof artifactId !== "string" || (status !== "draft" && status !== "review" && status !== "published")) {
      return { ok: false, error: "valid artifactId and status are required" };
    }
    const index = state.artifacts.findIndex((item) => item.id === artifactId);
    if (index < 0) return { ok: false, error: "artifact not found" };
    state.artifacts[index] = { ...state.artifacts[index]!, status, updatedAt: new Date().toISOString() };
    record(paneId, `changed ${artifactId} to ${status}`);
    return { ok: true, revision: state.revision };
  }

  return { ok: false, error: "operation is not allowed for this pane" };
}

export function inspectPanesForLlm(path?: string): unknown {
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
    artifacts: state.artifacts.map((artifact) => ({ ...artifact })),
    recentChanges: state.changes.slice(-8),
  };
}

export function resetPanesForTests(): void {
  state = initialState();
  publish?.(snapshot());
}
