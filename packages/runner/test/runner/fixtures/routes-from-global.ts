// Shape (b) factory whose `routes` value is injected via globalThis, so a
// single fixture can drive the whole validation matrix (valid / bad format /
// duplicate / bad method / defaults) from the test file.
export default () => ({
  systemPrompt: "routes-from-global agent",
  routes: (globalThis as { __routesFixture?: unknown }).__routesFixture,
});
