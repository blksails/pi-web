// Shape (a) definition declaring agent routes (spec agent-declared-routes).
// Plain object (duck-typed by the loader) — no agent-kit import, since the
// server package does not depend on agent-kit and this fixture lives inside
// the server tsconfig. Handlers are plain functions: they stay inside the
// subprocess and must survive normalization by reference.
export const galleryStatsHandler = (): unknown => ({ images: 3 });
export const canvasSnapshotHandler = (): unknown => ({ layers: [] });

export default {
  systemPrompt: "routes shape-a agent",
  routes: [
    {
      name: "gallery-stats",
      methods: ["GET", "POST"],
      description: "Gallery statistics",
      handler: galleryStatsHandler,
    },
    {
      // methods omitted → normalization must default to ["GET"].
      name: "canvas-snapshot",
      handler: canvasSnapshotHandler,
    },
  ],
};
