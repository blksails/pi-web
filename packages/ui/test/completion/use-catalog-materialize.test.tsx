/**
 * useCatalogMaterialize — accept 异步换写状态机单测(spec agent-attachment-catalog,任务
 * 5.2;Req 3.2, 3.4)。覆盖成功换写/原 token 被编辑放弃换写/失败撤销三态。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render, fireEvent } from "@testing-library/react";
import * as React from "react";
import type { Attachment, CompletionItem } from "@blksails/pi-web-protocol";
import {
  useCatalogMaterialize,
  type CatalogMaterializeClient,
} from "../../src/completion/use-catalog-materialize.js";

afterEach(() => {
  cleanup();
});

const ATTACHMENT_FIXTURE: Attachment = {
  id: "att_materialized",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 10,
  origin: "tool-output",
  sessionId: "s1",
  createdAt: new Date().toISOString(),
};

function catalogItem(id: string): CompletionItem {
  return {
    id,
    kind: "catalog",
    label: id,
    insertText: `@catalog:${id}`,
  } as CompletionItem;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 受控外壳:textarea + 触发 materialize 的按钮,模拟 PiCompletionPopover.onAccept 接线。 */
function Harness({
  client,
  initial,
  item,
  onMaterialized,
  onError,
}: {
  client: CatalogMaterializeClient;
  initial: string;
  item: CompletionItem;
  onMaterialized?: (id: string, att: Attachment, url: string) => void;
  onError?: (message: string) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const { materialize } = useCatalogMaterialize({
    client,
    sessionId: "s1",
    getValue: () => valueRef.current,
    onChange: setValue,
    ...(onMaterialized !== undefined ? { onMaterialized } : {}),
    ...(onError !== undefined ? { onError } : {}),
  });
  return (
    <div>
      <textarea
        data-testid="ta"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button data-testid="trigger" onClick={() => materialize(item)}>
        trigger
      </button>
    </div>
  );
}

describe("useCatalogMaterialize — 成功换写(Req 3.2)", () => {
  it("命中原 token → 原位换写为 @attachment:<attId>,回调 onMaterialized", async () => {
    const d = deferred<{ attachmentId: string; attachment: Attachment; displayUrl: string }>();
    const client: CatalogMaterializeClient = {
      materializeCatalogEntry: vi.fn(() => d.promise),
    };
    const onMaterialized = vi.fn();
    const utils = render(
      <Harness
        client={client}
        initial="hello @catalog:entry-1 world"
        item={catalogItem("entry-1")}
        onMaterialized={onMaterialized}
      />,
    );
    fireEvent.click(utils.getByTestId("trigger"));
    await act(async () => {
      d.resolve({
        attachmentId: "att_materialized",
        attachment: ATTACHMENT_FIXTURE,
        displayUrl: "http://x/attachments/att_materialized/raw",
      });
      await d.promise;
      await Promise.resolve();
    });
    const ta = utils.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello @attachment:att_materialized world");
    expect(onMaterialized).toHaveBeenCalledWith(
      "att_materialized",
      ATTACHMENT_FIXTURE,
      "http://x/attachments/att_materialized/raw",
    );
  });
});

describe("useCatalogMaterialize — 原 token 被编辑放弃换写(Req 3.2)", () => {
  it("完成时原 token 已不在场(用户编辑)→ 放弃换写,文本保持用户当前输入不变", async () => {
    const d = deferred<{ attachmentId: string; attachment: Attachment; displayUrl: string }>();
    const client: CatalogMaterializeClient = {
      materializeCatalogEntry: vi.fn(() => d.promise),
    };
    const utils = render(
      <Harness
        client={client}
        initial="hello @catalog:entry-1 world"
        item={catalogItem("entry-1")}
      />,
    );
    fireEvent.click(utils.getByTestId("trigger"));
    const ta = utils.getByTestId("ta") as HTMLTextAreaElement;
    // 用户在物化完成前编辑掉了原 token。
    fireEvent.change(ta, { target: { value: "hello world, no token anymore" } });
    await act(async () => {
      d.resolve({
        attachmentId: "att_materialized",
        attachment: ATTACHMENT_FIXTURE,
        displayUrl: "http://x/x",
      });
      await d.promise;
      await Promise.resolve();
    });
    expect(ta.value).toBe("hello world, no token anymore");
  });
});

describe("useCatalogMaterialize — 失败撤 token(Req 3.4)", () => {
  it("命中原 token → 连同尾随空格一并撤除,回调 onError", async () => {
    const d = deferred<{ attachmentId: string; attachment: Attachment; displayUrl: string }>();
    const client: CatalogMaterializeClient = {
      materializeCatalogEntry: vi.fn(() => d.promise),
    };
    const onError = vi.fn();
    const utils = render(
      <Harness
        client={client}
        initial="hello @catalog:entry-1 world"
        item={catalogItem("entry-1")}
        onError={onError}
      />,
    );
    fireEvent.click(utils.getByTestId("trigger"));
    await act(async () => {
      d.reject(new Error("catalog entry not found"));
      await d.promise.catch(() => undefined);
      await Promise.resolve();
    });
    const ta = utils.getByTestId("ta") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello world");
    expect(onError).toHaveBeenCalledWith("catalog entry not found");
  });

  it("完成时原 token 已不在场 → 不改写文本,仍回调 onError", async () => {
    const d = deferred<{ attachmentId: string; attachment: Attachment; displayUrl: string }>();
    const client: CatalogMaterializeClient = {
      materializeCatalogEntry: vi.fn(() => d.promise),
    };
    const onError = vi.fn();
    const utils = render(
      <Harness
        client={client}
        initial="hello @catalog:entry-1 world"
        item={catalogItem("entry-1")}
        onError={onError}
      />,
    );
    fireEvent.click(utils.getByTestId("trigger"));
    const ta = utils.getByTestId("ta") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "already edited" } });
    await act(async () => {
      d.reject(new Error("boom"));
      await d.promise.catch(() => undefined);
      await Promise.resolve();
    });
    expect(ta.value).toBe("already edited");
    expect(onError).toHaveBeenCalledWith("boom");
  });
});

describe("useCatalogMaterialize — 非 catalog 候选安全忽略", () => {
  it("kind !== catalog → no-op(不调用 client)", () => {
    const client: CatalogMaterializeClient = {
      materializeCatalogEntry: vi.fn(),
    };
    const utils = render(
      <Harness
        client={client}
        initial="hello @file:a.ts world"
        item={{
          id: "a.ts",
          kind: "file",
          providerId: "file",
          label: "a.ts",
          insertText: "@file:a.ts",
        }}
      />,
    );
    fireEvent.click(utils.getByTestId("trigger"));
    expect(client.materializeCatalogEntry).not.toHaveBeenCalled();
  });
});
