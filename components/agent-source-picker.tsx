"use client";

import * as React from "react";

/**
 * AgentSourcePicker — agent source input + submit.
 *
 * Accepts any `source` shape supported by agent-source-resolver (a local
 * directory path or a git source). Offers a "use default source" option when a
 * default is configured. Shows a loading indicator while a session is being
 * created and a recognizable error (with re-pick) on failure (Req 1.5 / 4.1 /
 * 4.4 / 4.5). It produces only a `source` string and a submit intent — it does
 * not create the session itself.
 */
export interface AgentSourcePickerProps {
  /** Called with the chosen source string (empty string ⇒ use default). */
  readonly onSubmit: (source: string) => void;
  /** Configured default source, if any. */
  readonly defaultSource?: string | undefined;
  /** True while a session is being created. */
  readonly loading?: boolean;
  /** Recognizable error message from a failed session creation. */
  readonly error?: string | undefined;
}

export function AgentSourcePicker({
  onSubmit,
  defaultSource,
  loading = false,
  error,
}: AgentSourcePickerProps): React.JSX.Element {
  const [value, setValue] = React.useState<string>(defaultSource ?? "");

  const submit = (source: string): void => {
    if (loading) return;
    onSubmit(source);
  };

  const onFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    submit(value.trim());
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center p-6"
      data-agent-source-picker
    >
      <form
        onSubmit={onFormSubmit}
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-[hsl(var(--card-foreground))] shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Start a pi-web session</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Enter an agent source — a local directory with an{" "}
            <code>index.ts</code> (custom agent) or any directory (general CLI
            mode) or a git source.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Agent source</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="./examples/hello-agent or https://github.com/org/repo"
            disabled={loading}
            data-agent-source-input
            className="rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
        </label>

        {error !== undefined ? (
          <p
            role="alert"
            data-agent-source-error
            className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={loading}
            data-agent-source-submit
            className="inline-flex items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            {loading ? "Creating session…" : "Start session"}
          </button>

          {defaultSource !== undefined ? (
            <button
              type="button"
              disabled={loading}
              data-agent-source-default
              onClick={() => submit("")}
              className="inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Use default source
            </button>
          ) : null}
        </div>

        {loading ? (
          <p
            data-agent-source-loading
            className="text-sm text-[hsl(var(--muted-foreground))]"
          >
            Resolving source and spawning agent…
          </p>
        ) : null}
      </form>
    </div>
  );
}
