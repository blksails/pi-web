# Design: archive-tools

## Overview

在 `@blksails/pi-web-tool-kit` 增加 **node-only** 归档运算模块（路径安全 + zip 编解码 + rar 后端探测），经 `tool-kit/runtime` 导出；`examples/archive-agent` 用 `defineTool` 包装为三个 agent 工具。核心逻辑可在 vitest 中对真实临时目录直接调用。

## Architecture

```
Agent (examples/archive-agent)
  customTools: [zipTool, unzipTool, unrarTool]
        │
        ▼
packages/tool-kit/src/archive/   (node-only, via ./runtime)
  path-safety.ts   resolveUnderRoot / assertInside
  zip-ops.ts       createZip / listZipEntries / extractZip (pure Node zlib+fs)
  rar-ops.ts       extractRar (spawn unrar|unar|bsdtar; clear failure)
  types.ts         ArchiveResult 判别联合
  index.ts
```

## Components

### path-safety

- `resolveUnderRoot(root, userPath): { ok: true, abs } | { ok: false, code: "PATH_ESCAPE" }`
- 使用 `path.resolve` + 前缀检查（root + sep）；可选 realpath 后再次校验。
- `joinUnderRoot(root, ...segments)` 同口径。

### zip-ops

- **createZip**: 遍历源路径（文件/目录），写入 ZIP（DEFLATE 或 STORE），entry 名为相对 root 的 posix 路径。
- **listZipEntries**: 解析 central directory，返回 name / compressedSize / method。
- **extractZip**: 列出全部 entry → 对每个 name 做 `resolveUnderRoot(destRoot, name)` → 任一条失败则整次失败且不写逃逸文件 → 通过后解压。
- 不依赖系统 `zip`/`unzip` 二进制，保证 CI 可测与 zip-slip 可控。

### rar-ops

- 探测顺序：`unrar` → `unar` → `bsdtar`（`bsdtar -tf` 可列则先列后检路径）。
- 无后端：`{ ok: false, code: "RAR_BACKEND_UNAVAILABLE" }`。
- 有后端：在 dest 下提取；能 list 时先 zip-slip 检。

### tools (example agent)

三个 `defineTool`：

| name | params |
|------|--------|
| `zip` | `paths: string[]`, `output: string` |
| `unzip` | `archive: string`, `destination?: string` (默认 archive 同名去扩展) |
| `unrar` | `archive: string`, `destination?: string` |

`execute` 调用 archive 模块，`cwd/root = process.cwd()`。

## Error codes

| code | meaning |
|------|---------|
| `PATH_ESCAPE` | 路径或 entry 逃逸 root |
| `NOT_FOUND` | 源/归档不存在 |
| `INVALID_ARCHIVE` | 损坏或非 zip |
| `RAR_BACKEND_UNAVAILABLE` | 主机无 rar 后端 |
| `IO_ERROR` | 其它 IO |

## Testing

- 单元：path-safety 边界、`..`、绝对路径。
- 集成（真实 tmp）：zip→unzip 内容字节相等；恶意 `../evil` entry 失败且 root 外无 evil；unrar 成功或 `RAR_BACKEND_UNAVAILABLE`。

## Non-goals

- 加密 zip/rar、分卷 rar、7z。
- 修改 session engine / sandbox 策略。
