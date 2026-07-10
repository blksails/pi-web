# 载荷格式的真实校验（任务 2.5，Req 2.2–2.5）

对**真实的 86MB `dist/`** 跑一次 `pack-payload` → `unpack.mjs`，逐项比对。全部命令实际执行。

## 产出

```
$ node scripts/build-unpacker.mjs
[build-unpacker] payload/unpack.mjs (127 KB)

$ node scripts/pack-payload.mjs
[pack-payload] dist.tar.zst 9.4 MB（9284 个文件条目，zstd-19，21.8s）
[pack-payload] sha256 61d502ed931a… → 运行时目录 0.1.3-61d502ed931a
```

## 零运行时依赖自检

在 `/private/tmp/...`（**无 `node_modules`**）下直接运行打包后的解包器：

```
$ node <repo>/payload/unpack.mjs --help
用法:
  unpack.mjs [--payload-dir <dir>] [--runtime-root <dir>] [--lock-wait-ms <n>] [--json]
```

## 解包结果 vs 源树

比对基准是 `find -L dist`（**跟随符号链接**）。用 `find dist` 会得到 8795，
把正确的归档误判为损坏——PoC 首轮正是栽在这里。

| 指标 | 源（`find -L dist`） | 解包 |
|---|---:|---:|
| 文件数 | 9284 | **9284** |
| 可执行位文件数 | 39 | **39** |
| 符号链接数 | 11（`find dist -type l`） | **0** |
| 体积 | 86 MB | **89 MB** |

- **相对路径集合 `diff` 零差异**（9284 条）。
- 顶层条目齐全（Req 6.1）：`client examples lib node_modules packages schema-registry.data.json server.mjs`
- 抽样 sha256 一致：`server.mjs`、`node_modules/jiti/lib/jiti-cli.mjs`、`schema-registry.data.json`、`lib/app/stub-agent-process.mjs`
- 155 字符长路径条目存在且非空（1318 B）：
  `node_modules/@mistralai/mistralai/esm/models/operations/getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost.js`
- 原符号链接 `node_modules/@blksails/pi-web-server` 已实体化为**真实目录**（非链接）。

**89 MB vs 86 MB 的 3MB 差额是 dereference 的固有代价**：`packages/*`（489 个文件）
被复制进 `node_modules/@blksails/*`。这笔账已计入 Req 12 的磁盘对比，不得忽略。

## 完整性标记与快路径

```
$ cat <runtimeRoot>/0.1.3-61d502ed931a/.ok
{ "schema": 1, "version": "0.1.3",
  "digest": "61d502ed931a2c4e50b8a682a28ca5039b748579bd031ea88f67c2248a72ae1c",
  "entries": 9284, "unpackedAt": "2026-07-09T11:03:28.184Z" }
```

| 调用 | `unpacked` | `elapsedMs` |
|---|---|---:|
| 首次（真实解包 89MB / 9284 文件） | `true` | 5646 |
| 二次（命中 `.ok`） | `false` | **1** |

命中路径只读 `payload.json` 与 `.ok` 两个小文件，不读取 9.4MB 载荷、不重算摘要（Req 10.1）。
