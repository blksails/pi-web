/** 引擎无关的视频工作流契约与可恢复 Runtime。 */

export const WORKFLOW_SCHEMA_VERSION = 1;

export type WorkflowNodeKind = "task" | "parallel" | "branch" | "subworkflow";
export type WorkflowNodeStatus = "pending" | "running" | "paused" | "succeeded" | "skipped" | "failed";
export type WorkflowRunStatus = "succeeded" | "failed" | "paused";

export interface WorkflowRetryPolicy {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
}

export interface WorkflowCondition {
  readonly sourceNodeId: string;
  readonly equals?: unknown;
  readonly notEquals?: unknown;
}

export interface WorkflowBudget {
  readonly maxSteps?: number;
  readonly maxCost?: number;
}

export interface WorkflowNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly dependencies: readonly string[];
  readonly operation: string;
  readonly input?: unknown;
  readonly retry?: WorkflowRetryPolicy;
  readonly condition?: WorkflowCondition;
  readonly cacheKey?: string;
  readonly subworkflow?: WorkflowSpec;
}

export interface WorkflowSpec {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly nodes: readonly WorkflowNode[];
  readonly maxParallel?: number;
  readonly budget?: WorkflowBudget;
}

export interface WorkflowTaskContext {
  readonly runId: string;
  readonly node: WorkflowNode;
  readonly input: unknown;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

export interface WorkflowTaskResult {
  readonly output?: unknown;
  readonly cost?: number;
}

export type WorkflowOperation = (context: WorkflowTaskContext) => WorkflowTaskResult | Promise<WorkflowTaskResult>;
export type WorkflowHandlers = Readonly<Record<string, WorkflowOperation>>;

export interface WorkflowCache {
  get(key: string): WorkflowTaskResult | Promise<WorkflowTaskResult | undefined> | undefined;
  set(key: string, value: WorkflowTaskResult): void | Promise<void>;
}

export interface WorkflowEvent {
  readonly id: string;
  readonly type: "node_started" | "node_succeeded" | "node_skipped" | "node_failed" | "workflow_paused" | "workflow_failed" | "workflow_succeeded";
  readonly nodeId?: string;
  readonly message?: string;
}

export interface WorkflowCheckpoint {
  readonly schemaVersion: number;
  readonly workflowId: string;
  readonly runId: string;
  readonly completedNodeIds: readonly string[];
  readonly nodeStates: Readonly<Record<string, WorkflowNodeStatus>>;
  readonly attempts: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly totalCost: number;
  readonly events: readonly WorkflowEvent[];
}

export interface WorkflowRunOptions {
  readonly runId?: string;
  readonly checkpoint?: WorkflowCheckpoint;
  readonly cache?: WorkflowCache;
  readonly maxParallel?: number;
  readonly shouldPause?: () => boolean;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: WorkflowEvent) => void;
}

export interface WorkflowExecutionResult {
  readonly status: WorkflowRunStatus;
  readonly runId: string;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly checkpoint: WorkflowCheckpoint;
  readonly events: readonly WorkflowEvent[];
  readonly attempts: number;
  readonly totalCost: number;
  readonly error?: string;
}

export interface WorkflowValidationResult {
  readonly ok: boolean;
  readonly spec?: WorkflowSpec;
  readonly errors: readonly string[];
}

export interface WorkflowInvalidationResult {
  readonly ok: boolean;
  readonly checkpoint?: WorkflowCheckpoint;
  readonly affectedNodeIds: readonly string[];
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validNodeKind(value: unknown): value is WorkflowNodeKind {
  return value === "task" || value === "parallel" || value === "branch" || value === "subworkflow";
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateGraph(nodes: readonly WorkflowNode[], errors: string[]): void {
  const byId = new Map<string, WorkflowNode>();
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node) || typeof node.id !== "string" || node.id.trim() === "") errors.push(`nodes[${index}].id 无效`);
    if (byId.has(node.id)) errors.push(`节点 ID 重复：${node.id}`);
    byId.set(node.id, node);
    if (!validNodeKind(node.kind)) errors.push(`节点 ${node.id} 的 kind 无效`);
    if (typeof node.operation !== "string" || node.operation.trim() === "") errors.push(`节点 ${node.id} 缺少 operation`);
    if (!Array.isArray(node.dependencies) || node.dependencies.some((dependency) => typeof dependency !== "string")) errors.push(`节点 ${node.id} 的 dependencies 无效`);
    if (node.kind === "subworkflow" && !isRecord(node.subworkflow)) errors.push(`子工作流节点 ${node.id} 缺少 subworkflow`);
    if (node.retry !== undefined && (!isRecord(node.retry) || (node.retry.maxAttempts !== undefined && !positiveInteger(node.retry.maxAttempts)))) errors.push(`节点 ${node.id} 的 retry 无效`);
  }
  for (const node of nodes) {
    for (const dependency of node.dependencies) if (!byId.has(dependency)) errors.push(`节点 ${node.id} 依赖不存在：${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push(`工作流存在循环依赖：${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

export function validateWorkflowSpec(value: unknown): WorkflowValidationResult {
  if (!isRecord(value)) return { ok: false, errors: ["workflow spec 必须为对象"] };
  const errors: string[] = [];
  if (value.schemaVersion !== WORKFLOW_SCHEMA_VERSION) errors.push(`schemaVersion 必须为 ${WORKFLOW_SCHEMA_VERSION}`);
  for (const key of ["id", "title"] as const) if (typeof value[key] !== "string" || (value[key] as string).trim() === "") errors.push(`workflow.${key} 无效`);
  if (!positiveInteger(value.version)) errors.push("workflow.version 必须为正整数");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) errors.push("workflow.nodes 不能为空");
  if (value.maxParallel !== undefined && !positiveInteger(value.maxParallel)) errors.push("workflow.maxParallel 必须为正整数");
  if (value.budget !== undefined && (!isRecord(value.budget)
    || (value.budget.maxSteps !== undefined && !positiveInteger(value.budget.maxSteps))
    || (value.budget.maxCost !== undefined && (typeof value.budget.maxCost !== "number" || value.budget.maxCost < 0)))) errors.push("workflow.budget 无效");
  if (errors.length === 0) {
    const nodes = value.nodes as readonly WorkflowNode[];
    validateGraph(nodes, errors);
    for (const node of nodes) {
      if (node.kind === "subworkflow" && node.subworkflow !== undefined) {
        const nested = validateWorkflowSpec(node.subworkflow);
        if (!nested.ok) errors.push(...nested.errors.map((error) => `节点 ${node.id}: ${error}`));
      }
    }
  }
  return errors.length === 0 ? { ok: true, spec: value as unknown as WorkflowSpec, errors: [] } : { ok: false, errors };
}

export function invalidateWorkflowCheckpoint(
  specValue: unknown,
  checkpoint: WorkflowCheckpoint,
  changedNodeIds: readonly string[],
): WorkflowInvalidationResult {
  const validation = validateWorkflowSpec(specValue);
  if (!validation.ok || validation.spec === undefined) return { ok: false, affectedNodeIds: [], errors: validation.errors };
  const spec = validation.spec;
  if (checkpoint.workflowId !== spec.id || checkpoint.schemaVersion !== WORKFLOW_SCHEMA_VERSION) return { ok: false, affectedNodeIds: [], errors: ["Checkpoint 与工作流不匹配"] };
  const ids = new Set(spec.nodes.map((node) => node.id));
  const unknown = changedNodeIds.filter((id) => !ids.has(id));
  if (unknown.length > 0) return { ok: false, affectedNodeIds: [], errors: [`待失效节点不存在：${unknown.join(", ")}`] };
  const affected = new Set(changedNodeIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of spec.nodes) {
      if (!affected.has(node.id) && node.dependencies.some((dependency) => affected.has(dependency))) {
        affected.add(node.id);
        expanded = true;
      }
    }
  }
  const nodeStates = { ...checkpoint.nodeStates };
  const attempts = { ...checkpoint.attempts };
  const outputs = { ...checkpoint.outputs };
  for (const id of affected) {
    nodeStates[id] = "pending";
    delete attempts[id];
    delete outputs[id];
  }
  return {
    ok: true,
    affectedNodeIds: [...affected],
    errors: [],
    checkpoint: {
      ...checkpoint,
      completedNodeIds: checkpoint.completedNodeIds.filter((id) => !affected.has(id)),
      nodeStates,
      attempts,
      outputs,
    },
  };
}

function checkpointFor(
  spec: WorkflowSpec,
  runId: string,
  completedNodeIds: ReadonlySet<string>,
  nodeStates: Readonly<Record<string, WorkflowNodeStatus>>,
  attempts: Readonly<Record<string, number>>,
  outputs: Readonly<Record<string, unknown>>,
  totalCost: number,
  events: readonly WorkflowEvent[],
): WorkflowCheckpoint {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowId: spec.id,
    runId,
    completedNodeIds: [...completedNodeIds],
    nodeStates: { ...nodeStates },
    attempts: { ...attempts },
    outputs: { ...outputs },
    totalCost,
    events: [...events],
  };
}

function event(runId: string, events: readonly WorkflowEvent[], type: WorkflowEvent["type"], nodeId?: string, message?: string): WorkflowEvent {
  return { id: `${runId}:${String(events.length + 1).padStart(3, "0")}`, type, ...(nodeId === undefined ? {} : { nodeId }), ...(message === undefined ? {} : { message }) };
}

function conditionPasses(node: WorkflowNode, outputs: Readonly<Record<string, unknown>>): boolean {
  const condition = node.condition;
  if (condition === undefined) return true;
  const output = outputs[condition.sourceNodeId];
  if (condition.equals !== undefined) return Object.is(output, condition.equals);
  if (condition.notEquals !== undefined) return !Object.is(output, condition.notEquals);
  return Boolean(output);
}

function abortError(signal?: AbortSignal): string | undefined {
  return signal?.aborted === true ? "工作流已取消" : undefined;
}

function checkpointResult(
  status: WorkflowRunStatus,
  runId: string,
  spec: WorkflowSpec,
  completed: ReadonlySet<string>,
  states: Readonly<Record<string, WorkflowNodeStatus>>,
  attempts: Readonly<Record<string, number>>,
  outputs: Readonly<Record<string, unknown>>,
  totalCost: number,
  events: readonly WorkflowEvent[],
  error?: string,
): WorkflowExecutionResult {
  return {
    status,
    runId,
    outputs: { ...outputs },
    checkpoint: checkpointFor(spec, runId, completed, states, attempts, outputs, totalCost, events),
    events: [...events],
    attempts: Object.values(attempts).reduce((sum, count) => sum + count, 0),
    totalCost,
    ...(error === undefined ? {} : { error }),
  };
}

async function executeNode(
  spec: WorkflowSpec,
  node: WorkflowNode,
  handlers: WorkflowHandlers,
  runId: string,
  outputs: Readonly<Record<string, unknown>>,
  options: WorkflowRunOptions,
  attempts: Record<string, number>,
  maxSteps?: number,
): Promise<{ readonly ok: true; readonly result: WorkflowTaskResult } | { readonly ok: false; readonly paused?: boolean; readonly error: string }> {
  const maxAttempts = node.retry?.maxAttempts ?? 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abort = abortError(options.signal);
    if (abort !== undefined) return { ok: false, error: abort };
    if (options.shouldPause?.() === true) return { ok: false, paused: true, error: "工作流已暂停" };
    if (maxSteps !== undefined && Object.values(attempts).reduce((sum, count) => sum + count, 0) >= maxSteps) return { ok: false, error: `超出工作流步骤预算：${maxSteps}` };
    attempts[node.id] = (attempts[node.id] ?? 0) + 1;
    try {
      let result: WorkflowTaskResult;
      if (node.kind === "subworkflow" && node.subworkflow !== undefined) {
        const nested = await runWorkflow(node.subworkflow, handlers, { ...options, runId: `${runId}:${node.id}`, checkpoint: undefined });
        if (nested.status !== "succeeded") return { ok: false, error: nested.error ?? `子工作流 ${node.id} 未完成` };
        result = { output: nested.outputs, cost: nested.totalCost };
      } else {
        const handler = handlers[node.operation];
        if (handler === undefined) return { ok: false, error: `未注册工作流操作：${node.operation}` };
        result = await handler({ runId, node, input: node.input, outputs, attempt, signal: options.signal });
      }
      return { ok: true, result };
    } catch (error) {
      if (attempt >= maxAttempts) return { ok: false, error: error instanceof Error ? error.message : String(error) };
      const delay = Math.max(0, node.retry?.backoffMs ?? 0);
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  return { ok: false, error: `节点 ${node.id} 未执行` };
}

export async function runWorkflow(
  value: unknown,
  handlers: WorkflowHandlers,
  options: WorkflowRunOptions = {},
): Promise<WorkflowExecutionResult> {
  const validation = validateWorkflowSpec(value);
  if (!validation.ok || validation.spec === undefined) {
    const fallbackId = isRecord(value) && typeof value.id === "string" ? value.id : "invalid-workflow";
    const fallbackSpec = { schemaVersion: WORKFLOW_SCHEMA_VERSION, id: fallbackId, title: "Invalid workflow", version: 1, nodes: [] } as WorkflowSpec;
    return checkpointResult("failed", options.runId ?? `run-${fallbackId}`, fallbackSpec, new Set(), {}, {}, {}, 0, [], validation.errors.join("; "));
  }
  const spec = validation.spec;
  const checkpoint = options.checkpoint;
  if (checkpoint !== undefined && (checkpoint.workflowId !== spec.id || checkpoint.schemaVersion !== WORKFLOW_SCHEMA_VERSION)) {
    return checkpointResult("failed", options.runId ?? `run-${spec.id}`, spec, new Set(), {}, {}, {}, 0, [], "Checkpoint 与工作流不匹配");
  }
  const runId = options.runId ?? checkpoint?.runId ?? `run-${spec.id}`;
  const completed = new Set(checkpoint?.completedNodeIds ?? []);
  const states: Record<string, WorkflowNodeStatus> = { ...(checkpoint?.nodeStates ?? {}) };
  const attempts: Record<string, number> = { ...(checkpoint?.attempts ?? {}) };
  const outputs: Record<string, unknown> = { ...(checkpoint?.outputs ?? {}) };
  const events: WorkflowEvent[] = [...(checkpoint?.events ?? [])];
  let totalCost = checkpoint?.totalCost ?? 0;
  const maxParallel = Math.max(1, options.maxParallel ?? spec.maxParallel ?? 1);
  const budget = spec.budget;
  const emit = (item: WorkflowEvent): void => {
    events.push(item);
    options.onEvent?.(item);
  };
  const finish = (status: WorkflowRunStatus, error?: string): WorkflowExecutionResult => checkpointResult(status, runId, spec, completed, states, attempts, outputs, totalCost, events, error);

  while (completed.size < spec.nodes.length) {
    const abort = abortError(options.signal);
    if (abort !== undefined) {
      emit(event(runId, events, "workflow_failed", undefined, abort));
      return finish("failed", abort);
    }
    if (options.shouldPause?.() === true) {
      emit(event(runId, events, "workflow_paused", undefined, "等待恢复"));
      return finish("paused", "工作流已暂停");
    }
    const ready: WorkflowNode[] = [];
    for (const node of spec.nodes) {
      if (completed.has(node.id)) continue;
      if (!node.dependencies.every((dependency) => completed.has(dependency))) continue;
      if (!conditionPasses(node, outputs)) {
        states[node.id] = "skipped";
        completed.add(node.id);
        const skipped = event(runId, events, "node_skipped", node.id, "分支条件不满足");
        emit(skipped);
        continue;
      }
      ready.push(node);
    }
    if (ready.length === 0) {
      const error = "工作流无法继续：存在未满足的依赖或循环状态";
      emit(event(runId, events, "workflow_failed", undefined, error));
      return finish("failed", error);
    }
    const attempted = Object.values(attempts).reduce((sum, count) => sum + count, 0);
    if (budget?.maxSteps !== undefined && attempted >= budget.maxSteps) {
      const error = `超出工作流步骤预算：${budget.maxSteps}`;
      emit(event(runId, events, "workflow_failed", undefined, error));
      return finish("failed", error);
    }
    const remainingSteps = budget?.maxSteps === undefined ? maxParallel : Math.max(1, budget.maxSteps - attempted);
    const batch = ready.slice(0, Math.min(maxParallel, remainingSteps));
    for (const node of batch) states[node.id] = "running";
    const results = await Promise.all(batch.map(async (node) => {
      if (node.cacheKey !== undefined && options.cache !== undefined) {
        const cached = await options.cache.get(node.cacheKey);
        if (cached !== undefined) return { node, cached: true, execution: { ok: true as const, result: cached } };
      }
      emit(event(runId, events, "node_started", node.id));
      const execution = await executeNode(spec, node, handlers, runId, outputs, options, attempts, budget?.maxSteps);
      return { node, cached: false, execution };
    }));
    for (const item of results) {
      if (!item.execution.ok) {
        states[item.node.id] = item.execution.paused === true ? "paused" : "failed";
        if (item.execution.paused === true) {
          emit(event(runId, events, "workflow_paused", item.node.id, item.execution.error));
          return finish("paused", item.execution.error);
        }
        emit(event(runId, events, "node_failed", item.node.id, item.execution.error));
        return finish("failed", item.execution.error);
      }
      const cost = Math.max(0, item.execution.result.cost ?? 0);
      if (budget?.maxCost !== undefined && totalCost + cost > budget.maxCost) {
        const error = `超出工作流成本预算：${budget.maxCost}`;
        states[item.node.id] = "failed";
        emit(event(runId, events, "node_failed", item.node.id, error));
        return finish("failed", error);
      }
      totalCost += cost;
      outputs[item.node.id] = item.execution.result.output;
      states[item.node.id] = "succeeded";
      completed.add(item.node.id);
      if (item.node.cacheKey !== undefined && options.cache !== undefined && !item.cached) await options.cache.set(item.node.cacheKey, item.execution.result);
      emit(event(runId, events, "node_succeeded", item.node.id, item.cached ? "命中缓存" : undefined));
    }
    if (budget?.maxSteps !== undefined && Object.values(attempts).reduce((sum, count) => sum + count, 0) > budget.maxSteps) {
      const error = `超出工作流步骤预算：${budget.maxSteps}`;
      emit(event(runId, events, "workflow_failed", undefined, error));
      return finish("failed", error);
    }
  }
  emit(event(runId, events, "workflow_succeeded", undefined, "全部节点完成"));
  return finish("succeeded");
}
