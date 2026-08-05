import { describe, expect, it, vi } from "vitest";
import { createResourceRoutes } from "../../src/resources/routes.js";
import type { ResourceManager } from "../../src/resources/types.js";

const auth = { anonymous: false } as never;

function context(pathname: string): { req: Request; url: URL; auth: typeof auth } {
  return { req: new Request(`http://localhost${pathname}`, { method: "DELETE" }), url: new URL(`http://localhost${pathname}`), auth };
}

describe("resource routes", () => {
  it("DELETE tolerates the handler /api base path", async () => {
    const remove = vi.fn<NonNullable<ResourceManager["remove"]>>().mockResolvedValue(undefined);
    const manager = {
      list: vi.fn(),
      createSkill: vi.fn(),
      createTemplate: vi.fn(),
      remove,
      installPackage: vi.fn(),
      removePackage: vi.fn(),
    } satisfies ResourceManager;
    const route = createResourceRoutes({ manager, adminPolicy: () => true })
      .find((item) => item.method === "DELETE" && item.path.includes("templates"))!;

    const response = await route.handler(context("/api/resources/templates/agent/review"));
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("template", "agent", "review");
  });

  it("malformed encoded names return 400 instead of escaping the route", async () => {
    const manager = {
      list: vi.fn(),
      createSkill: vi.fn(),
      createTemplate: vi.fn(),
      remove: vi.fn(),
      installPackage: vi.fn(),
      removePackage: vi.fn(),
    } satisfies ResourceManager;
    const route = createResourceRoutes({ manager, adminPolicy: () => true })
      .find((item) => item.method === "DELETE" && item.path.includes("templates"))!;

    const response = await route.handler(context("/api/resources/templates/agent/%E0%A4%A"));
    expect(response.status).toBe(400);
    expect(manager.remove).not.toHaveBeenCalled();
  });
});
