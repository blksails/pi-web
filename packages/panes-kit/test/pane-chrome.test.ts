import { describe, expect, it } from "vitest";
import {
  PANE_CHROME_SCRIPT_FILE,
  injectPaneChromeExternal,
  injectPaneChromeHtml,
  paneChromeBootScript,
  paneChromeScriptSource,
  withDefaultPaneChrome,
  wrapPaneDocument,
  wrapPaneDocumentForHost,
} from "../src/pane-chrome.js";
import { definePanes } from "../src/contract.js";

const SAMPLE = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;

describe("pane chrome default wrapper", () => {
  it("inline inject inserts style+script before </body>", () => {
    const out = injectPaneChromeHtml(SAMPLE);
    expect(out).toContain("data-pi-pane-chrome");
    expect(out).toContain("pi-pane-chrome-host");
    expect(out).toContain("port.start");
    expect(out.indexOf("data-pi-pane-chrome")).toBeLessThan(out.toLowerCase().indexOf("</body>"));
  });

  it("external inject references shared script file", () => {
    const out = injectPaneChromeExternal(SAMPLE);
    expect(out).toContain(`src="./${PANE_CHROME_SCRIPT_FILE}"`);
    expect(out).toContain("data-pi-pane-chrome");
    expect(out).not.toContain("port.start("); // logic lives in external file
  });

  it("wrapPaneDocument is the default entry (inline / external)", () => {
    expect(wrapPaneDocument(SAMPLE)).toContain("data-pi-pane-chrome");
    expect(wrapPaneDocument(SAMPLE, { mode: "external" })).toContain(
      `src="./${PANE_CHROME_SCRIPT_FILE}"`,
    );
  });

  it("idempotent — second inject is no-op", () => {
    const once = wrapPaneDocument(SAMPLE);
    expect(wrapPaneDocument(once)).toBe(once);
    const ext = wrapPaneDocument(SAMPLE, { mode: "external" });
    expect(wrapPaneDocument(ext, { mode: "external" })).toBe(ext);
  });

  it("script: shared port, overflow more, reload/activate/close", () => {
    const src = paneChromeScriptSource();
    expect(src).toContain("__PI_PANE_PORT__");
    expect(src).toContain("pi-pane-port");
    expect(src).toContain("overflowList");
    expect(src).toContain("TAB_MIN");
    expect(src).toContain("workspace.close");
    expect(src).toContain("workspace.activate");
    expect(src).toContain("workspace.reload");
    expect(src).toContain("instanceId:id");
    expect(src).toContain("addInstRow");
    expect(src).not.toContain("未显示的标签");
    expect(src).not.toContain("溢出');");
    expect(src).toContain("pi.workspace");
  });

  it("paneChromeBootScript injects CSS + chrome IIFE (native bottom layer)", () => {
    const boot = paneChromeBootScript();
    expect(boot).toContain("data-pi-pane-chrome");
    expect(boot).toContain("__PI_PANE_CHROME__");
    expect(boot).toContain("pi.workspace");
  });

  it("withDefaultPaneChrome wraps all inline docs at host entry with paneId + ready", () => {
    const def = definePanes({
      id: "t",
      panes: [
        {
          id: "a",
          title: "A",
          document: { kind: "inline", srcDoc: SAMPLE },
          capabilities: {},
        },
        {
          id: "b",
          title: "B",
          document: { kind: "html", src: "/pane-b.html" },
          capabilities: {},
        },
      ],
    });
    const out = withDefaultPaneChrome(def);
    const a = out.panes.find((p) => p.id === "a")!;
    const b = out.panes.find((p) => p.id === "b")!;
    expect(a.document.kind).toBe("inline");
    if (a.document.kind === "inline") {
      expect(a.document.srcDoc).toContain("data-pi-pane-chrome");
      expect(a.document.srcDoc).toContain("__PI_PANE_ID__");
      expect(a.document.srcDoc).toContain('"a"');
      expect(a.document.srcDoc).toContain("announceReady");
      expect(a.document.srcDoc).toContain("pane:ready");
    }
    expect(b.document).toEqual({ kind: "html", src: "/pane-b.html" });
    // force re-wrap：同源字符串稳定 → 引用可新可旧，内容一致
    const again = withDefaultPaneChrome(out);
    const a2 = again.panes.find((p) => p.id === "a")!;
    if (a.document.kind === "inline" && a2.document.kind === "inline") {
      expect(a2.document.srcDoc).toBe(a.document.srcDoc);
    }
  });

  it("wrapPaneDocumentForHost only touches inline and force-upgrades chrome", () => {
    expect(wrapPaneDocumentForHost({ kind: "html", src: "/x" }, "x")).toEqual({
      kind: "html",
      src: "/x",
    });
    const stale = wrapPaneDocument(SAMPLE); // 构建期包装：无 data-pi-pane-id 标签
    expect(stale).toContain("data-pi-pane-chrome");
    expect(stale).not.toContain("data-pi-pane-id");
    const wrapped = wrapPaneDocumentForHost({ kind: "inline", srcDoc: stale }, "host:browser");
    expect(wrapped.kind).toBe("inline");
    if (wrapped.kind === "inline") {
      expect(wrapped.srcDoc).toContain("data-pi-pane-chrome");
      expect(wrapped.srcDoc).toContain("data-pi-pane-id");
      expect(wrapped.srcDoc).toContain("host:browser");
      expect(wrapped.srcDoc).toContain("pane:ready");
    }
  });

  it("script announces ready without guest", () => {
    const src = paneChromeScriptSource();
    expect(src).toContain("announceReady");
    expect(src).toContain("pi-pane-id");
    expect(src).toContain("pane:ready");
  });

  it("script self-embeds CSS via JSON and ensureChromeStyle", () => {
    const src = paneChromeScriptSource();
    expect(src).toContain("ensureChromeStyle");
    expect(src).toContain("CSS_TEXT");
    expect(src).toContain("#pi-pane-chrome");
    expect(src).toContain(".pi-c-bar");
  });

  it("chrome bar always has border-bottom; selected tab uses border-left not box-shadow", () => {
    const html = injectPaneChromeHtml(SAMPLE);
    expect(html).toMatch(/\.pi-c-bar\{[^}]*border-bottom:1px solid/);
    expect(html).toMatch(/\.pi-c-tab\[aria-selected=true\]\{[^}]*border-left-color:/);
    expect(html).not.toMatch(/\.pi-c-tab\[aria-selected=true\]\{[^}]*box-shadow:/);
    expect(html).not.toContain("inset 0 -2px");
    const src = paneChromeScriptSource();
    expect(src).toMatch(/border-bottom:1px solid/);
    expect(src).toMatch(/border-left-color:/);
  });
});
