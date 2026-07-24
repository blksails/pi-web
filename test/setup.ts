import "@testing-library/jest-dom/vitest";

// Node 25 的 --localstorage-file 残缺垫片会以不完整对象覆盖 jsdom 的 Web Storage;
// 缺方法时换成内存实现,保证回归套件在任意 Node 小版本可跑。
if (typeof window !== "undefined" && typeof window.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
}
