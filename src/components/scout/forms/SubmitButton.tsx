/// <reference types="react-dom/canary" />

"use client";

/**
 * A submit button that knows whether its own `<form>` is in flight.
 *
 * ## Why this exists
 *
 * On React 19 the three server-action forms in this app used
 * `useActionState`, which hands back `[state, action, pending]` — one hook, and
 * the pending flag arrives in the same component that owns the state.
 *
 * React 18 has no `useActionState`. The equivalent is `useFormState` from
 * `react-dom`, and it returns only `[state, action]`. The pending flag comes
 * from a **separate** hook, `useFormStatus`, which reads the status of the
 * nearest enclosing `<form>` and therefore has to be called from a component
 * *inside* that form rather than from the one that renders it. This component
 * is that inside-the-form piece.
 *
 * ## `onPendingChange`
 *
 * `useFormStatus` is deliberately scoped to one form, so a parent rendering two
 * forms cannot see either one's pending state. The admin row needs exactly
 * that — it disables Reject while Approve is running. `onPendingChange` reports
 * the flag back up so the parent can restore that behaviour. Pass a stable
 * callback (`useCallback`); it is an effect dependency.
 *
 * ## Types
 *
 * `useFormState` and `useFormStatus` exist at runtime because the Next.js App
 * Router compiles client components against its own vendored React canary
 * (18.3.0-canary at Next 14.2), not against the `react-dom` in `node_modules`,
 * which does not export them. `@types/react-dom@18` reflects that split by
 * declaring both in `canary.d.ts`, which is not loaded by default — the empty
 * import below pulls it in for this file only, rather than adding
 * `react-dom/canary` to the `types` array in `tsconfig.json`, which the host
 * project governs.
 *
 * The corollary: a Vitest render of a component using these hooks resolves the
 * real `react-dom` 18.3.1 and gets `undefined`. Nothing in the suite renders
 * one today. If that changes, the test needs to alias `react-dom` to
 * `next/dist/compiled/react-dom`.
 */

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/scout/ui";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "children"> {
  /** Label when the form is idle. */
  children: React.ReactNode;
  /** Label while this form is submitting. Falls back to `children`. */
  pendingLabel?: React.ReactNode;
  /** Reported whenever this form's pending state changes. Must be stable. */
  onPendingChange?: (pending: boolean) => void;
}

export function SubmitButton({
  children,
  pendingLabel,
  onPendingChange,
  disabled,
  ...rest
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  return (
    <Button type="submit" disabled={disabled || pending} {...rest}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
