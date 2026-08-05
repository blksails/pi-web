import test from "node:test";
import assert from "node:assert/strict";
import {
  runWorkflow,
  invalidateWorkflowCheckpoint,
  validateWorkflowSpec,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowCache,
  type WorkflowHandlers,
  type WorkflowSpec,
  type WorkflowTaskResult,
} from "./workflow.js";

function spec(nodes: WorkflowSpec["nodes"], options: Partial<WorkflowSpec> = {}): WorkflowSpec {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: options.id ?? "workflow-test",
    title: options.title ?? "测试工作流",
    version: options.version ?? 1,
    nodes,
    ...(options.maxParallel === undefined ? {} : { maxParallel: options.maxParallel }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  };
}

test("workflow validation rejects missing dependencies and cycles", () => {
  const result = validateWorkflowSpec(spec([
    { id: "a", kind: "task", dependencies: ["missing"], operation: "noop" },
    { id: "b", kind: "task", dependencies: ["c"], operation: "noop" },
    { id: "c", kind: "task", dependencies: ["b"], operation: "noop" },
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("依赖不存在")));
  assert.ok(result.errors.some((error) => error.includes("循环依赖")));
});

test("runtime executes DAG, branch, parallel nodes, and retries", async () => {
  const calls: string[] = [];
  let flakyAttempts = 0;
  const handlers: WorkflowHandlers = {
    decide: () => ({ output: true }),
    flaky: () => {
      flakyAttempts += 1;
      calls.push(`flaky-${flakyAttempts}`);
      if (flakyAttempts === 1) throw new Error("transient");
      return { output: "ready", cost: 0.4 };
    },
    parallelA: () => { calls.push("a"); return { output: "A" }; },
    parallelB: () => { calls.push("b"); return { output: "B" }; },
    join: ({ outputs }) => ({ output: `${outputs.a}|${outputs.b}` }),
    skipped: () => { calls.push("skipped"); return { output: "bad" }; },
  };
  const result = await runWorkflow(spec([
    { id: "decision", kind: "branch", dependencies: [], operation: "decide" },
    { id: "ready", kind: "task", dependencies: ["decision"], operation: "flaky", retry: { maxAttempts: 2 } },
    { id: "skipped", kind: "task", dependencies: ["decision"], operation: "skipped", condition: { sourceNodeId: "decision", equals: false } },
    { id: "a", kind: "parallel", dependencies: ["ready"], operation: "parallelA" },
    { id: "b", kind: "parallel", dependencies: ["ready"], operation: "parallelB" },
    { id: "join", kind: "task", dependencies: ["a", "b"], operation: "join" },
  ], { maxParallel: 2 }), handlers);
  assert.equal(result.status, "succeeded");
  assert.equal(flakyAttempts, 2);
  assert.equal(result.outputs.join, "A|B");
  assert.equal(result.checkpoint.nodeStates.skipped, "skipped");
  assert.equal(calls.includes("skipped"), false);
});

test("checkpoint pauses and resumes without re-running completed nodes", async () => {
  const calls: string[] = [];
  let pause = false;
  const handlers: WorkflowHandlers = {
    first: () => { calls.push("first"); pause = true; return { output: 1 }; },
    second: () => { calls.push("second"); return { output: 2 }; },
  };
  const workflow = spec([
    { id: "first", kind: "task", dependencies: [], operation: "first" },
    { id: "second", kind: "task", dependencies: ["first"], operation: "second" },
  ], { id: "pause-test" });
  const paused = await runWorkflow(workflow, handlers, { shouldPause: () => pause });
  assert.equal(paused.status, "paused");
  assert.deepEqual(paused.checkpoint.completedNodeIds, ["first"]);
  assert.deepEqual(calls, ["first"]);

  const resumed = await runWorkflow(workflow, handlers, { checkpoint: paused.checkpoint, shouldPause: () => false });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(calls, ["first", "second"]);
});

test("cache, subworkflow, and step budget are resumable runtime concerns", async () => {
  const values = new Map<string, WorkflowTaskResult>();
  const cache: WorkflowCache = {
    get: (key) => values.get(key),
    set: (key, value) => { values.set(key, value); },
  };
  let cachedCalls = 0;
  const handlers: WorkflowHandlers = {
    cached: () => { cachedCalls += 1; return { output: "cached" }; },
    nested: () => ({ output: "nested" }),
  };
  const nested: WorkflowSpec = spec([{ id: "inside", kind: "task", dependencies: [], operation: "nested" }], { id: "nested-test" });
  const workflow = spec([
    { id: "cached", kind: "task", dependencies: [], operation: "cached", cacheKey: "cache-1" },
    { id: "sub", kind: "subworkflow", dependencies: ["cached"], operation: "subworkflow", subworkflow: nested },
  ], { id: "cache-test" });
  const first = await runWorkflow(workflow, handlers, { cache });
  const second = await runWorkflow(workflow, handlers, { cache, runId: "second-run" });
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "succeeded");
  assert.equal(cachedCalls, 1);
  assert.ok(second.events.some((event) => event.nodeId === "cached" && event.message === "命中缓存"));

  const budgeted = await runWorkflow(spec([
    { id: "one", kind: "task", dependencies: [], operation: "cached" },
    { id: "two", kind: "task", dependencies: ["one"], operation: "cached" },
  ], { id: "budget-test", budget: { maxSteps: 1 } }), handlers);
  assert.equal(budgeted.status, "failed");
  assert.match(budgeted.error ?? "", /步骤预算/);
});

test("impact invalidation clears only changed node and transitive downstream", async () => {
  const calls: string[] = [];
  const handlers: WorkflowHandlers = {
    a: () => { calls.push("a"); return { output: "a" }; },
    b: () => { calls.push("b"); return { output: "b" }; },
    c: () => { calls.push("c"); return { output: "c" }; },
    independent: () => { calls.push("independent"); return { output: "independent" }; },
  };
  const workflow = spec([
    { id: "a", kind: "task", dependencies: [], operation: "a" },
    { id: "b", kind: "task", dependencies: ["a"], operation: "b" },
    { id: "c", kind: "task", dependencies: ["b"], operation: "c" },
    { id: "independent", kind: "task", dependencies: [], operation: "independent" },
  ], { id: "invalidation-test", maxParallel: 2 });
  const first = await runWorkflow(workflow, handlers);
  assert.equal(first.status, "succeeded");
  const invalidated = invalidateWorkflowCheckpoint(workflow, first.checkpoint, ["b"]);
  assert.equal(invalidated.ok, true);
  assert.deepEqual(invalidated.affectedNodeIds, ["b", "c"]);
  assert.deepEqual(invalidated.checkpoint?.completedNodeIds, ["a", "independent"]);

  const resumed = await runWorkflow(workflow, handlers, { checkpoint: invalidated.checkpoint });
  assert.equal(resumed.status, "succeeded");
  assert.deepEqual(calls, ["a", "independent", "b", "c", "b", "c"]);
});
