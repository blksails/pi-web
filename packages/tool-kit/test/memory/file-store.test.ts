import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe } from "vitest";
import { FileMemoryStore } from "../../src/memory/file-store.js";
import { runMemoryStoreContract } from "./contract.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe("FileMemoryStore contract", () => {
  runMemoryStoreContract(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mem-"));
    dirs.push(dir);
    return new FileMemoryStore(dir);
  });
});
