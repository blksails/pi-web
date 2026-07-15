# Requirements: archive-tools

## Introduction

为 pi-web agent 提供可调用的 **zip / unzip / unrar** 归档工具，在会话工作目录（cwd）为根的前提下创建与解压归档，并强制路径逃逸防护（zip-slip）。

## Requirements

### Requirement 1: 路径根与安全

**User Story:** As an agent operator, I want archive operations confined to the session workspace so that tools cannot read or write outside the intended root.

#### Acceptance Criteria

1. WHEN a tool path argument is relative, THE Archive Tools SHALL resolve it against the session root (default `process.cwd()` unless an explicit root option is provided by the caller).
2. WHEN a path resolves outside the session root after normalization and `realpath` where available, THE Archive Tools SHALL return a non-success structured result and SHALL NOT perform the file operation.
3. WHEN extracting an archive, THE Archive Tools SHALL reject any entry whose final extract path would escape the chosen extract root (absolute entry names, `..` segments, or symlink escape), and SHALL NOT write any files for that rejected operation outside the extract root.

### Requirement 2: zip 创建

**User Story:** As an agent, I want to package one or more workspace paths into a `.zip` file.

#### Acceptance Criteria

1. WHEN the agent invokes zip with one or more existing paths under the session root and an output path under the session root, THE Archive Tools SHALL create a `.zip` containing those paths (files and directory trees) with paths stored relative to the session root or a documented base.
2. WHEN a source path is missing or outside the root, THE Archive Tools SHALL return a non-success result without partially claiming success for that invocation.
3. WHEN zip succeeds, THE Archive Tools SHALL return a structured success payload including the output path and at least an entry count or byte size indicator.

### Requirement 3: unzip 解压

**User Story:** As an agent, I want to extract a `.zip` into a directory under the workspace.

#### Acceptance Criteria

1. WHEN the agent invokes unzip with a zip path and destination under the session root, and all entries are safe, THE Archive Tools SHALL extract contents into the destination.
2. WHEN the zip file is missing, unreadable, or not a valid zip, THE Archive Tools SHALL return a non-success structured result.
3. WHEN any entry fails the zip-slip check, THE Archive Tools SHALL return non-success and SHALL NOT leave extracted files outside the extract root.

### Requirement 4: unrar 解压

**User Story:** As an agent, I want to extract a `.rar` when the host supports it, or receive a clear failure when it does not.

#### Acceptance Criteria

1. WHEN a rar backend is available on the host (`unrar`, `unar`, or `bsdtar` capable of the fixture) and the archive is valid and entries are safe, THE Archive Tools SHALL extract into the destination under the session root.
2. WHEN no rar backend is available, THE Archive Tools SHALL return a non-success result with a stable error code (e.g. `RAR_BACKEND_UNAVAILABLE`) and a human-readable message; THE Archive Tools SHALL NOT throw an uncaught exception.
3. WHEN entries would escape the extract root, THE Archive Tools SHALL reject extraction (same as unzip zip-slip policy) when the backend allows pre-check; if the backend cannot list entries, THE Archive Tools SHALL extract into a dedicated destination under root only and document the residual risk, preferring fail-closed when listing is possible.

### Requirement 5: Agent 可调用表面

**User Story:** As an agent author, I want tools registered so the model can call zip/unzip/unrar.

#### Acceptance Criteria

1. THE system SHALL expose agent-callable tools covering zip, unzip, and unrar (three tools or one multi-action tool with distinct actions).
2. THE example agent source (or documented registration) SHALL include the tools in `customTools` (or equivalent).
3. Tool parameters SHALL be schema-validated (TypeBox / defineTool parameters).

### Requirement 6: 可测试性

**User Story:** As a developer, I want pure-ish operations testable on real temp directories without mocking the unit under test.

#### Acceptance Criteria

1. WHEN tests run on temp fixtures, zip then unzip SHALL restore file content byte-equal for a representative file.
2. WHEN tests run unrar on a representative fixture, extraction SHALL succeed or return the documented backend-unavailable failure.
3. WHEN tests supply a zip with a path-escape entry, extraction SHALL fail and the parent of the extract root SHALL remain free of the malicious payload file.
