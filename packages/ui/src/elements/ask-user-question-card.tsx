/**
 * AskUserQuestionCard — 富问题组表单卡片(select 请求命中 AskUserQuestion 哨兵时的渲染分支)。
 *
 * 背景:AskUserQuestion 特性零协议帧改动,问题组经哨兵搭载在既有 `select` 请求的 title
 * 上(见 `@blksails/pi-web-protocol` 的 ask-user-question codec)。本组件只负责“已解码问题组”
 * 的多题富表单渲染与本地状态收集——单选题以互斥 radiogroup 呈现(默认首项)、多选题以
 * checkbox 呈现(可 0..n)、每个选项展示 label + description,并始终附加自由文本输入。
 * 提交时将本地作答编码为 `AskAnswers` 并调用 `encodeAskAnswers` 生成回传 value,同时生成
 * 一份人类可读摘要,二者经 `onSubmitEncoded` 回调上交给宿主(接线逻辑不在本组件内,见
 * `pi-interaction.tsx` 的 select 分支,任务 3.1)。
 *
 * 主题走 shadcn CSS 变量(cn),无硬编码颜色;`data-pi-askq-*` 为测试锚点。
 */
import * as React from "react";
import type {
  AskAnswer,
  AskAnswers,
  AskQuestion,
  AskQuestionGroup,
  RpcExtensionUIRequest,
} from "@blksails/pi-web-protocol";
import { encodeAskAnswers } from "@blksails/pi-web-protocol";
import { Card } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { useI18n } from "../i18n/index.js";

export interface AskUserQuestionCardProps {
  /** 已解码的富问题组(1–4 题)。 */
  readonly group: AskQuestionGroup;
  /** 承载本次交互的 select 请求。 */
  readonly request: Extract<RpcExtensionUIRequest, { method: "select" }>;
  /** 提交进行中:禁用所有输入与按钮。 */
  readonly pending: boolean;
  /** 上一次提交失败的错误文案(如有)。 */
  readonly error?: string;
  /** 提交回调:`value` 为 `encodeAskAnswers` 编码结果,`summary` 为人类可读摘要。 */
  readonly onSubmitEncoded: (value: string, summary: string) => void;
  /** 取消回调。 */
  readonly onCancel: () => void;
}

/** 单题本地作答状态。 */
interface QuestionAnswerState {
  readonly selected: readonly string[];
  readonly other: string;
}

function initialAnswerState(question: AskQuestion): QuestionAnswerState {
  return {
    // 单选默认选中首个 option(R2.3);多选默认 0 选(R2.4)。
    selected: question.multiSelect ? [] : [question.options[0]!.label],
    other: "",
  };
}

/** 将本地作答状态数组组装为 codec 的 `AskAnswers`(Other 有文本才带上)。 */
function buildAnswers(
  group: AskQuestionGroup,
  states: readonly QuestionAnswerState[],
): AskAnswers {
  const answers: AskAnswer[] = group.questions.map((question, index) => {
    const state = states[index]!;
    const other = state.other.trim();
    return {
      header: question.header,
      question: question.question,
      selected: [...state.selected],
      ...(other.length > 0 ? { other } : {}),
    };
  });
  return { answers };
}

/** 组装人类可读摘要,形如 "鉴权方式: OAuth · 数据库: Postgres, MySQL"。 */
function buildSummary(answers: AskAnswers): string {
  return answers.answers
    .map((answer) => {
      const parts = [...answer.selected];
      if (answer.other !== undefined && answer.other.length > 0) {
        parts.push(answer.other);
      }
      return `${answer.header}: ${parts.join(", ")}`;
    })
    .join(" · ");
}

export function AskUserQuestionCard({
  group,
  request,
  pending,
  error,
  onSubmitEncoded,
  onCancel,
}: AskUserQuestionCardProps): React.JSX.Element {
  const t = useI18n();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [states, setStates] = React.useState<readonly QuestionAnswerState[]>(
    () => group.questions.map(initialAnswerState),
  );
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeQuestion = group.questions[activeIndex]!;
  const hasTabs = group.questions.length > 1;
  const isFirstQuestion = activeIndex === 0;
  const isLastQuestion = activeIndex === group.questions.length - 1;

  const tabId = (index: number): string =>
    `askq-${request.id}-tab-${index}`;
  const panelId = (index: number): string =>
    `askq-${request.id}-panel-${index}`;

  const activateTab = (index: number, focus = false): void => {
    if (pending) return;
    setActiveIndex(index);
    if (focus) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % group.questions.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + group.questions.length) % group.questions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = group.questions.length - 1;
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      activateTab(nextIndex, true);
    }
  };

  const setQuestionState = (
    index: number,
    updater: (prev: QuestionAnswerState) => QuestionAnswerState,
  ): void => {
    setStates((prev) =>
      prev.map((state, i) => (i === index ? updater(state) : state)),
    );
  };

  const handleSubmit = (): void => {
    const answers = buildAnswers(group, states);
    const value = encodeAskAnswers(answers);
    const summary = buildSummary(answers);
    onSubmitEncoded(value, summary);
  };

  return (
    <Card
      className="flex min-h-0 flex-col gap-0 overflow-hidden p-0"
      data-pi-askq-card
      role="group"
      aria-label={t("piInteraction.askq.groupLabel")}
    >
      {hasTabs ? (
        <div
          role="tablist"
          className="flex min-h-10 overflow-x-auto border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] px-2"
          data-pi-askq-tabs
        >
          {group.questions.map((question, index) => {
            const selected = activeIndex === index;
            return (
              <button
                key={`${request.id}-tab-${index}`}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={tabId(index)}
                aria-selected={selected}
                aria-controls={panelId(index)}
                tabIndex={selected ? 0 : -1}
                disabled={pending}
                onClick={() => activateTab(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`relative shrink-0 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? "text-[hsl(var(--foreground))] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[hsl(var(--primary))]"
                    : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                }`}
                data-pi-askq-tab={index}
              >
                {question.header}
              </button>
            );
          })}
        </div>
      ) : null}

      {hasTabs ? (
        group.questions.map((question, index) => (
          <div
            key={`${request.id}-panel-${index}`}
            id={panelId(index)}
            role="tabpanel"
            aria-labelledby={tabId(index)}
            hidden={activeIndex !== index}
            className="min-h-0 flex-1 px-4 py-4"
            data-pi-askq-panel={index}
          >
            <QuestionFieldset
              question={question}
              questionIndex={index}
              requestId={request.id}
              state={states[index]!}
              pending={pending}
              showHeader={false}
              onChange={(updater) => setQuestionState(index, updater)}
            />
          </div>
        ))
      ) : (
        <div
          className="min-h-0 flex-1 px-4 py-4"
          data-pi-askq-panel={0}
        >
          <QuestionFieldset
            question={activeQuestion}
            questionIndex={0}
            requestId={request.id}
            state={states[0]!}
            pending={pending}
            showHeader
            onChange={(updater) => setQuestionState(0, updater)}
          />
        </div>
      )}

      <div
        className="mt-auto flex flex-col gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
        data-pi-askq-actions
      >
        {error !== undefined ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-pi-askq-error
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {hasTabs && !isFirstQuestion ? (
            <Button
              variant="outline"
              onClick={() => activateTab(activeIndex - 1, true)}
              disabled={pending}
              data-pi-askq-previous
            >
              {t("piInteraction.askq.previous")}
            </Button>
          ) : null}
          {hasTabs && !isLastQuestion ? (
            <Button
              onClick={() => activateTab(activeIndex + 1, true)}
              disabled={pending}
              data-pi-askq-next
            >
              {t("piInteraction.askq.next")}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={pending} data-pi-askq-submit>
              {t("piInteraction.askq.submit")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            data-pi-askq-cancel
          >
            {t("piInteraction.askq.cancel")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 单题渲染:header + question + radio/checkbox 选项(含 description) + Other 输入。 */
function QuestionFieldset({
  question,
  questionIndex,
  requestId,
  state,
  pending,
  showHeader,
  onChange,
}: {
  readonly question: AskQuestion;
  readonly questionIndex: number;
  readonly requestId: string;
  readonly state: QuestionAnswerState;
  readonly pending: boolean;
  readonly showHeader: boolean;
  readonly onChange: (
    updater: (prev: QuestionAnswerState) => QuestionAnswerState,
  ) => void;
}): React.JSX.Element {
  const t = useI18n();
  const groupName = `askq-${requestId}-q${questionIndex}`;

  const toggleSingle = (label: string): void => {
    onChange((prev) => ({ ...prev, selected: [label] }));
  };

  const toggleMulti = (label: string, checked: boolean): void => {
    onChange((prev) => ({
      ...prev,
      selected: checked
        ? [...prev.selected, label]
        : prev.selected.filter((l) => l !== label),
    }));
  };

  const setOther = (text: string): void => {
    onChange((prev) => ({ ...prev, other: text }));
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-pi-askq-question={questionIndex}
    >
      <div className="flex flex-col gap-1">
        {showHeader ? (
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {question.header}
          </div>
        ) : null}
        <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
          {question.question}
        </div>
      </div>

      {question.multiSelect ? (
        <div className="flex flex-col gap-1">
          {question.options.map((option) => (
            <label
              key={option.label}
              className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors ${
                state.selected.includes(option.label)
                  ? "border-[hsl(var(--border))] bg-[hsl(var(--accent))]"
                  : "border-transparent hover:bg-[hsl(var(--accent)/0.6)]"
              }`}
            >
              <input
                type="checkbox"
                checked={state.selected.includes(option.label)}
                onChange={(e) => toggleMulti(option.label, e.target.checked)}
                disabled={pending}
                data-pi-askq-checkbox={option.label}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={question.question}
          className="flex flex-col gap-1"
        >
          {question.options.map((option) => (
            <label
              key={option.label}
              className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors ${
                state.selected.includes(option.label)
                  ? "border-[hsl(var(--border))] bg-[hsl(var(--accent))]"
                  : "border-transparent hover:bg-[hsl(var(--accent)/0.6)]"
              }`}
            >
              <input
                type="radio"
                name={groupName}
                checked={state.selected.includes(option.label)}
                onChange={() => toggleSingle(option.label)}
                disabled={pending}
                data-pi-askq-option={option.label}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span>{option.label}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <input
        type="text"
        aria-label={t("piInteraction.askq.otherLabel")}
        placeholder={t("piInteraction.askq.otherPlaceholder")}
        value={state.other}
        onChange={(e) => setOther(e.target.value)}
        disabled={pending}
        className="h-9 w-full rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        data-pi-askq-other
      />
    </div>
  );
}
