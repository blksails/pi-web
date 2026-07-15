import { describe, expect, it } from "vitest";
import {
  maskPaths,
  maskPathsDeep,
  maskHomePaths,
  parsePathDisplayMode,
  DEFAULT_PATH_DISPLAY_MODE,
} from "../../src/privacy/mask-home-paths.js";

describe("parsePathDisplayMode", () => {
  it("accepts known modes", () => {
    expect(parsePathDisplayMode("off")).toBe("off");
    expect(parsePathDisplayMode("home")).toBe("home");
    expect(parsePathDisplayMode("basename")).toBe("basename");
  });
  it("falls back to default", () => {
    expect(parsePathDisplayMode(undefined)).toBe(DEFAULT_PATH_DISPLAY_MODE);
    expect(parsePathDisplayMode("nope")).toBe(DEFAULT_PATH_DISPLAY_MODE);
  });
});

describe("maskPaths mode=home", () => {
  it("folds macOS/Linux/Windows home prefix", () => {
    expect(maskPaths("/Users/hysios/Projects/foo", "home")).toBe("~/Projects/foo");
    expect(maskPaths("/Users/hysios", "home")).toBe("~");
    expect(maskPaths("/home/alice/.config", "home")).toBe("~/.config");
    expect(maskPaths("C:\\Users\\bob\\docs", "home")).toBe("~\\docs");
  });

  it("masks embedded paths in prose", () => {
    expect(
      maskPaths("沙盒禁止访问 ~ (/Users/hysios) 目录", "home"),
    ).toBe("沙盒禁止访问 ~ (~) 目录");
  });
});

describe("maskPaths mode=basename", () => {
  it("keeps only the last path segment", () => {
    expect(
      maskPaths(
        "/Users/hysios/Projects/BlackSail/agents/pi-web/examples/daily-work-agent",
        "basename",
      ),
    ).toBe("daily-work-agent");
    expect(maskPaths("路径：/Users/hysios/Projects/foo/bar.ts", "basename")).toBe(
      "路径：bar.ts",
    );
  });

  it("bare home becomes ~ (no username leak)", () => {
    expect(maskPaths("/Users/hysios", "basename")).toBe("~");
    expect(maskPaths("blocked (/Users/hysios)", "basename")).toBe("blocked (~)");
  });

  it("handles windows", () => {
    expect(maskPaths("C:\\Users\\bob\\proj\\app", "basename")).toBe("app");
  });
});

describe("maskPaths mode=off", () => {
  it("returns text unchanged", () => {
    const raw = "/Users/hysios/Projects/foo";
    expect(maskPaths(raw, "off")).toBe(raw);
  });
});

describe("maskPaths safety", () => {
  it("does not touch bare /Users or /home deny roots", () => {
    expect(maskPaths("denyRead: /Users, /home", "home")).toBe(
      "denyRead: /Users, /home",
    );
    expect(maskPaths("denyRead: /Users, /home", "basename")).toBe(
      "denyRead: /Users, /home",
    );
  });

  it("does not touch unrelated paths", () => {
    expect(maskPaths("/usr/local/bin", "home")).toBe("/usr/local/bin");
    expect(maskPaths("/opt/homebrew/bin/python3", "basename")).toBe(
      "/opt/homebrew/bin/python3",
    );
  });

  it("maskHomePaths aliases mode=home", () => {
    expect(maskHomePaths("/Users/x/y")).toBe("~/y");
  });
});

describe("maskPathsDeep", () => {
  it("walks arrays and plain objects with mode", () => {
    expect(
      maskPathsDeep(
        {
          cwd: "/Users/hysios/proj",
          items: ["/home/alice/a/b", 1],
        },
        "basename",
      ),
    ).toEqual({
      cwd: "proj",
      items: ["b", 1],
    });
  });

  it("mode=off is identity", () => {
    const v = { p: "/Users/x/y" };
    expect(maskPathsDeep(v, "off")).toEqual(v);
  });
});
