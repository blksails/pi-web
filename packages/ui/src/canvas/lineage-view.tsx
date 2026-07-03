/**
 * LineageView — C 档灵感放大(aigc-canvas · Req 6.1 / 6.2 / 6.3 / 6.4)。
 *
 * 全部从快照派生(UI 本地,不发命令):
 *  - **血缘树**:读 `derivedFrom` 建父子关系;
 *  - **参数复用**:读选中资产 `genParams` 预填 A 档表单(经 `onReuseParams` 回调);
 *  - **A-B 对比**:选两张图并排(读 `displayUrl`);
 *  - **当前工作图链**:沿 `derivedFrom` 的一条 UI 本地路径,支持前进 / 回退。
 */
import * as React from "react";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { cn } from "../lib/cn.js";

export interface LineageNode {
  asset: GalleryAsset;
  children: LineageNode[];
}

/** 从扁平资产列表按 `derivedFrom` 建血缘树(纯函数;缺失父节点者作为根)。 */
export function buildLineageTree(assets: readonly GalleryAsset[]): LineageNode[] {
  const byId = new Map<string, LineageNode>();
  for (const a of assets) byId.set(a.attachmentId, { asset: a, children: [] });
  const roots: LineageNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.asset.derivedFrom;
    const parent = parentId !== undefined ? byId.get(parentId) : undefined;
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function TreeNode({
  node,
  depth,
  onReuseParams,
  currentId,
}: {
  node: LineageNode;
  depth: number;
  onReuseParams?: (asset: GalleryAsset) => void;
  currentId?: string;
}): React.JSX.Element {
  const a = node.asset;
  const isCurrent = currentId !== undefined && a.attachmentId === currentId;
  return (
    <>
      <Card
        data-lineage-node
        data-att-id={a.attachmentId}
        data-depth={depth}
        className={cn(
          "group relative w-20 shrink-0 overflow-hidden p-0",
          isCurrent && "ring-2 ring-[hsl(var(--ring))]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.displayUrl} alt={a.name} width={80} height={80} className="h-20 w-20 object-cover" />
        <div className="pointer-events-none absolute inset-x-0 top-0 truncate bg-gradient-to-b from-black/50 to-transparent px-1 py-0.5 text-[10px] text-white">
          {a.name}
        </div>
        {a.genParams !== undefined ? (
          <Button
            variant="secondary"
            size="sm"
            data-lineage-reuse
            data-att-id={a.attachmentId}
            onClick={() => onReuseParams?.(a)}
            className="absolute inset-x-0 bottom-0 hidden h-6 rounded-none px-1 text-[10px] group-hover:flex"
          >
            复用参数
          </Button>
        ) : null}
      </Card>
      {node.children.map((c) => (
        <TreeNode
          key={c.asset.attachmentId}
          node={c}
          depth={depth + 1}
          {...(onReuseParams !== undefined ? { onReuseParams } : {})}
          {...(currentId !== undefined ? { currentId } : {})}
        />
      ))}
    </>
  );
}

export interface LineageViewProps {
  readonly assets: readonly GalleryAsset[];
  /** A-B 对比:选中的两个 att_id(取前两项)。 */
  readonly compareIds?: readonly string[];
  /** 当前工作图链(att_id 序列)。 */
  readonly chain?: readonly string[];
  readonly onReuseParams?: (asset: GalleryAsset) => void;
  readonly onChainStep?: (direction: "back" | "forward", id: string) => void;
  /** 当前工作图 att_id(仅高亮,可选增强)。 */
  readonly currentId?: string;
}

export function LineageView({
  assets,
  compareIds,
  chain,
  onReuseParams,
  currentId,
}: LineageViewProps): React.JSX.Element {
  const tree = React.useMemo(() => buildLineageTree(assets), [assets]);
  const byId = React.useMemo(() => {
    const m = new Map<string, GalleryAsset>();
    for (const a of assets) m.set(a.attachmentId, a);
    return m;
  }, [assets]);

  const comparePair = (compareIds ?? [])
    .slice(0, 2)
    .map((id) => byId.get(id))
    .filter((a): a is GalleryAsset => a !== undefined);

  return (
    <div data-lineage-view className="flex flex-col gap-2 text-xs">
      {/* 血缘树(横向缩略条)。 */}
      <div className="mb-0.5 font-medium text-[hsl(var(--muted-foreground))]">版本血缘</div>
      <div
        data-lineage-tree
        className="pi-scrollbar-thin flex gap-2 overflow-x-auto pb-1"
      >
        {tree.map((n) => (
          <TreeNode
            key={n.asset.attachmentId}
            node={n}
            depth={0}
            {...(onReuseParams !== undefined ? { onReuseParams } : {})}
            {...(currentId !== undefined ? { currentId } : {})}
          />
        ))}
      </div>

      {/* A-B 对比。 */}
      {comparePair.length === 2 ? (
        <div data-lineage-compare className="grid grid-cols-2 gap-1">
          {comparePair.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.attachmentId}
              data-compare-img
              data-att-id={a.attachmentId}
              src={a.displayUrl}
              alt={a.name}
              className="w-full rounded object-contain"
            />
          ))}
        </div>
      ) : null}

      {/* 当前工作图链。 */}
      {chain !== undefined && chain.length > 0 ? (
        <div data-lineage-chain className="flex flex-wrap items-center gap-1">
          {chain.map((id, i) => (
            <span key={id} data-chain-step data-att-id={id} className="opacity-70">
              {byId.get(id)?.name ?? id}
              {i < chain.length - 1 ? " → " : ""}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
