/**
 * archive-tools — node-only 归档运算（经 tool-kit/runtime 导出）。
 */
export {
  normalizeRoot,
  isInsideRoot,
  resolveUnderRoot,
  resolveUnderRootReal,
  resolveZipEntry,
  type PathResolveResult,
} from "./path-safety.js";
export {
  createZip,
  listZipEntries,
  extractZip,
  writeZipEntries,
} from "./zip-ops.js";
export {
  extractRar,
  detectRarBackend,
  writePlaceholderRar,
  rimraf,
  type RarBackend,
} from "./rar-ops.js";
export type {
  ArchiveResult,
  ArchiveErr,
  ArchiveOk,
  ArchiveErrorCode,
  ZipEntryMeta,
} from "./types.js";
