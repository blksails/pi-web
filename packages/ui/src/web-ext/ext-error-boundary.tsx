/**
 * ExtErrorBoundary — 隔离扩展渲染错误(Req 10.3)。
 *
 * 扩展提供的插槽/渲染器抛错时,捕获并渲染 fallback(默认 null),保证宿主内核与其它
 * 区域不受影响。可选 `onError` 上报供审计。
 */
import * as React from "react";

interface Props {
  readonly children: React.ReactNode;
  readonly fallback?: React.ReactNode;
  readonly onError?: (error: Error) => void;
}
interface State {
  readonly hasError: boolean;
}

export class ExtErrorBoundary extends React.Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
