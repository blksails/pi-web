// Shape (c): default export is a marked CreateAgentSessionRuntimeFactory.
// The loader must pass it through unchanged (no re-mapping).
import { markRuntimeFactory } from "../../../src/runner/agent-loader.js";

const factory = markRuntimeFactory(async () => {
  throw new Error("shape-c factory should not be invoked during loading");
});

export default factory;
