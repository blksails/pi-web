/**
 * SessionItemMenu — 会话项右侧操作菜单(session-list-item-actions)。
 *
 * 每个会话项右侧一个 hover/聚焦显现的 `⋯` 触发,展开「重命名 / 删除 / 收藏·取消收藏」菜单:
 *  - 触发与菜单交互一律 `stopPropagation`,不冒泡到整行「恢复会话」(Req 1.4);
 *  - 「重命名」经 `onRename` 上抛(由面板切入内联编辑态,Req 3.1);
 *  - 「删除」先弹二次确认(dialog),确认后才经 `onDelete` 上抛(Req 2.1/2.2);
 *  - 「收藏/取消收藏」经 `onToggleFavorite` 上抛(Req 4.5)。
 * 组件不持 pi 接线,全部交互经注入回调上抛。文案为可覆盖的中文默认(与面板同范式)。
 *
 * 同文件另导出 `SessionRenameField`:内联重命名输入(Req 3.1/3.4/3.5)——Enter 提交(trim 后
 * 空则等价取消)、Esc/失焦取消,空名不提交、保留原名。由面板在编辑态渲染于标题位。
 */
import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

export interface SessionItemMenuProps {
  readonly sessionId: string;
  /** 该会话是否已收藏(决定菜单展示「收藏」或「取消收藏」)。 */
  readonly isFavorite: boolean;
  /** 请求进入内联重命名态(由面板处理)。 */
  readonly onRename: (sessionId: string) => void;
  /** 二次确认后删除(由面板/宿主处理实际删除)。 */
  readonly onDelete: (sessionId: string) => void;
  /** 切换收藏态(favorite=目标态)。 */
  readonly onToggleFavorite: (sessionId: string, favorite: boolean) => void;
  readonly className?: string;
  // 文案(可覆盖的中文默认)。
  readonly menuLabel?: string;
  readonly renameLabel?: string;
  readonly deleteLabel?: string;
  readonly favoriteLabel?: string;
  readonly unfavoriteLabel?: string;
  readonly deleteConfirmTitle?: string;
  readonly deleteConfirmBody?: string;
  readonly deleteConfirmLabel?: string;
  readonly cancelLabel?: string;
}

/** 阻断冒泡的点击包装:防止菜单交互误触整行「恢复会话」(Req 1.4)。 */
function stop(e: React.SyntheticEvent): void {
  e.stopPropagation();
}

export function SessionItemMenu(
  props: SessionItemMenuProps,
): React.ReactElement {
  const t = useI18n();
  const {
    sessionId,
    isFavorite,
    onRename,
    onDelete,
    onToggleFavorite,
    className,
  } = props;
  const menuLabel = props.menuLabel ?? t("sessionItemMenu.menu");
  const renameLabel = props.renameLabel ?? t("sessionItemMenu.rename");
  const deleteLabel = props.deleteLabel ?? t("sessionItemMenu.delete");
  const favoriteLabel = props.favoriteLabel ?? t("sessionItemMenu.favorite");
  const unfavoriteLabel =
    props.unfavoriteLabel ?? t("sessionItemMenu.unfavorite");
  const deleteConfirmTitle =
    props.deleteConfirmTitle ?? t("sessionItemMenu.deleteConfirmTitle");
  const deleteConfirmBody =
    props.deleteConfirmBody ?? t("sessionItemMenu.deleteConfirmBody");
  const deleteConfirmLabel =
    props.deleteConfirmLabel ?? t("sessionItemMenu.deleteConfirm");
  const cancelLabel = props.cancelLabel ?? t("sessionItemMenu.cancel");

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={menuLabel}
            data-pi-session-item-menu={sessionId}
            onClick={stop}
            onPointerDown={stop}
            className={cn(
              // 默认隐藏,整行 hover / 组内聚焦 / 自身聚焦 / 菜单展开时显现(Req 1.2)。
              "shrink-0 rounded-[var(--radius)] px-1.5 py-1 text-xs text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--muted))] focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 group-focus-within:opacity-100 data-[open]:opacity-100",
              className,
            )}
            data-open={menuOpen ? "" : undefined}
          >
            ⋯
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-40 p-1"
          onClick={stop}
          onCloseAutoFocus={(e) => e.preventDefault()}
          data-pi-session-item-menu-content={sessionId}
        >
          <MenuItem
            data-pi-session-item-rename={sessionId}
            onSelect={() => {
              setMenuOpen(false);
              onRename(sessionId);
            }}
          >
            {renameLabel}
          </MenuItem>
          <MenuItem
            data-pi-session-item-favorite={sessionId}
            onSelect={() => {
              setMenuOpen(false);
              onToggleFavorite(sessionId, !isFavorite);
            }}
          >
            {isFavorite ? unfavoriteLabel : favoriteLabel}
          </MenuItem>
          <MenuItem
            data-pi-session-item-delete={sessionId}
            destructive
            onSelect={() => {
              setMenuOpen(false);
              setConfirmOpen(true);
            }}
          >
            {deleteLabel}
          </MenuItem>
        </PopoverContent>
      </Popover>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          onClick={stop}
          data-pi-session-item-delete-confirm={sessionId}
        >
          <DialogHeader>
            <DialogTitle>{deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{deleteConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              data-pi-session-item-delete-cancel={sessionId}
              onClick={() => setConfirmOpen(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-pi-session-item-delete-confirm-btn={sessionId}
              onClick={() => {
                setConfirmOpen(false);
                onDelete(sessionId);
              }}
            >
              {deleteConfirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 菜单项:统一样式 + 键盘/点击可达;点击阻断冒泡。 */
function MenuItem(props: {
  readonly children: React.ReactNode;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly [key: `data-${string}`]: string | undefined;
}): React.ReactElement {
  const { children, onSelect, destructive, ...rest } = props;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cn(
        "block w-full rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[hsl(var(--muted))] focus-visible:bg-[hsl(var(--muted))] focus-visible:outline-none",
        destructive
          ? "text-[hsl(var(--destructive))]"
          : "text-[hsl(var(--foreground))]",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SessionRenameFieldProps {
  readonly sessionId: string;
  /** 编辑初始值(当前显示名)。 */
  readonly initialValue: string;
  /** 提交新名(已由本组件保证 trim 后非空)。 */
  readonly onSubmit: (sessionId: string, name: string) => void;
  /** 取消编辑(空名提交 / Esc / 失焦 → 保留原名)。 */
  readonly onCancel: (sessionId: string) => void;
  readonly className?: string;
  readonly placeholder?: string;
}

/**
 * 内联重命名输入(Req 3.1/3.4/3.5):Enter 提交(trim 后空 → 等价取消,不发写请求)、
 * Esc/失焦取消。挂载即自动聚焦并全选,便于直接改写。
 */
export function SessionRenameField(
  props: SessionRenameFieldProps,
): React.ReactElement {
  const { sessionId, initialValue, onSubmit, onCancel, className, placeholder } =
    props;
  const [value, setValue] = React.useState(initialValue);
  const committedRef = React.useRef(false);

  const commit = React.useCallback((): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      onCancel(sessionId); // 空名不提交,保留原名(Req 3.4)
      return;
    }
    onSubmit(sessionId, trimmed);
  }, [value, sessionId, onSubmit, onCancel]);

  const cancel = React.useCallback((): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel(sessionId);
  }, [sessionId, onCancel]);

  return (
    <Input
      autoFocus
      data-pi-session-item-rename-input={sessionId}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onClick={stop}
      onPointerDown={stop}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel(); // Esc 取消(Req 3.5)
        }
      }}
      onBlur={cancel}
      className={cn("h-7 px-2 py-1 text-sm", className)}
    />
  );
}
