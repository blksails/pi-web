/**
 * 桌面壳:目录选择核心纯函数单测(spec desktop-directory-picker task 2.1,Req 2.1/2.2/2.5/5.1)。
 *
 * 覆盖三分支:选中→绝对路径;取消/无选择→undefined;showOpenDialog 抛错→undefined(不 reject)。
 * 测纯函数 runDirectoryPicker,不依赖 Electron 运行时(与 external-link 纯函数测同法)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  runDirectoryPicker,
  type OpenDialogResult,
  type ShowOpenDialog,
} from "@/desktop/src/dialog-bridge";

const resolves = (r: OpenDialogResult): ShowOpenDialog => () => Promise.resolve(r);

describe("runDirectoryPicker(目录选择核心)", () => {
  it("选中目录 → 返回其绝对路径(Req 2.2)", async () => {
    const dlg = resolves({ canceled: false, filePaths: ["/Users/x/proj"] });
    await expect(runDirectoryPicker(dlg, undefined)).resolves.toBe("/Users/x/proj");
  });

  it("透传父窗口给对话框(Req 2.1)", async () => {
    const win = { id: "main" } as never;
    const spy = vi.fn<ShowOpenDialog>(() =>
      Promise.resolve({ canceled: false, filePaths: ["/p"] }),
    );
    await runDirectoryPicker(spy, win);
    expect(spy).toHaveBeenCalledWith(win);
  });

  it("用户取消 → undefined(Req 2.5)", async () => {
    const dlg = resolves({ canceled: true, filePaths: [] });
    await expect(runDirectoryPicker(dlg, undefined)).resolves.toBeUndefined();
  });

  it("无选择(空 filePaths)→ undefined(Req 2.5)", async () => {
    const dlg = resolves({ canceled: false, filePaths: [] });
    await expect(runDirectoryPicker(dlg, undefined)).resolves.toBeUndefined();
  });

  it("showOpenDialog 抛错 → 降级为 undefined,不 reject(Req 5.1)", async () => {
    const dlg: ShowOpenDialog = () => Promise.reject(new Error("dialog boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runDirectoryPicker(dlg, undefined)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
