import { describe, expect, it } from "vitest";
import {
  SEARCH_PANE_CSS,
  searchPaneModule,
  searchPanePackage,
  searchRoutes,
} from "./index.js";

describe("search pane package", () => {
  it("提供可移植 Pane 入口与路由", () => {
    expect(searchPaneModule.entry).toBeInstanceOf(URL);
    expect(searchPaneModule.entry.pathname).toMatch(/\/src\/guest\.tsx$/);
    expect(searchPaneModule.capabilities.routes).toEqual([
      { name: "creative-search", methods: ["POST"] },
    ]);
    expect(searchRoutes.map((route) => route.name)).toEqual(["creative-search"]);
    expect(searchPanePackage.pane).toBe(searchPaneModule);
    expect(searchPanePackage.extensions).toHaveLength(1);
    expect(SEARCH_PANE_CSS).toContain(".search-field");
  });
});
