# Implementation Plan

- [x] 1. Path safety pure functions
  - 实现 `resolveUnderRoot` / 逃逸判定；单元测试覆盖相对路径、`..`、绝对路径。
  - _Requirements: 1.1, 1.2_
  - _Boundary: packages/tool-kit/src/archive/path-safety.ts_

- [x] 2. Zip create / list / extract (Node-native)
  - 实现 createZip、listZipEntries、extractZip；解压前全量 zip-slip 检查；失败不写 root 外。
  - _Requirements: 1.3, 2.1–2.3, 3.1–3.3_
  - _Depends: 1_
  - _Boundary: packages/tool-kit/src/archive/zip-ops.ts_

- [x] 3. Unrar with backend probe
  - 探测 unrar/unar/bsdtar；成功提取或返回 `RAR_BACKEND_UNAVAILABLE`；可 list 时做路径检查。
  - _Requirements: 4.1–4.3_
  - _Depends: 1_
  - _Boundary: packages/tool-kit/src/archive/rar-ops.ts_

- [x] 4. Runtime export + example agent tools
  - 从 `tool-kit/runtime` 导出 archive API；`examples/archive-agent` 注册 zip/unzip/unrar `customTools`。
  - _Requirements: 5.1–5.3_
  - _Depends: 2, 3_
  - _Boundary: examples/archive-agent_

- [x] 5. Fixture tests + evidence log
  - zip↔unzip 字节相等；恶意 zip 逃逸拒绝；unrar 成功或明确失败；输出写入 SCRATCH。
  - _Requirements: 6.1–6.3_
  - _Depends: 2, 3_
  - _Boundary: packages/tool-kit/test/archive/_
