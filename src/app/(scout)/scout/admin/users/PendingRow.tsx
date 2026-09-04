"use client";

import { useCallback, useState } from "react";
// React 18: `useFormState` from react-dom, not `useActionState` from react.
// It returns [state, action] only — no pending flag. See SubmitButton.
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/scout/forms/SubmitButton";
import { approveUserAction, rejectUserAction, type AdminActionState } from "../actions";

const INITIAL: AdminActionState = {};

export interface PendingRowProps {
  id: string;
  name: string;
  email: string;
  requestedAt: string;
}

export function PendingRow({ id, name, email, requestedAt }: PendingRowProps) {
  const [approveState, approve] = useFormState(approveUserAction, INITIAL);
  const [rejectState, reject] = useFormState(rejectUserAction, INITIAL);

  /**
   * `useFormStatus` only sees the form it is inside, so neither button can
   * observe the other's. These two flags are reported up out of the buttons so
   * the row can keep the original rule: while either action is in flight, both
   * buttons are disabled. Without them a user could fire Reject on top of an
   * Approve that has not returned yet.
   */
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const busy = approving || rejecting;

  // Stable — SubmitButton depends on these in an effect.
  const onApproving = useCallback((pending: boolean) => setApproving(pending), []);
  const onRejecting = useCallback((pending: boolean) => setRejecting(pending), []);

  const message = approveState.message ?? rejectState.message;
  const error = approveState.error ?? rejectState.error;

  return (
    <>
      <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] items-center border-t border-slate-200 px-5 py-[14px] text-[13.5px] text-slate-700 gap-3 max-[900px]:grid-cols-1 max-[900px]:gap-[6px]">
        <span className="font-semibold text-slate-900">{name}</span>
        <span className="break-all">{email}</span>
        <span>{requestedAt}</span>
        <span className="flex items-center gap-2 flex-wrap justify-end max-[900px]:justify-start">
          <form action={approve} className="flex items-center gap-2 flex-wrap justify-end max-[900px]:justify-start">
            <input type="hidden" name="userId" value={id} />
            <label className="sr-only" htmlFor={`role-${id}`}>
              Role for {name}
            </label>
            <select
              id={`role-${id}`}
              name="role"
              className="font-sans text-[13px] px-[10px] py-[6px] rounded border border-slate-300 bg-white text-slate-900"
              defaultValue="sales"
            >
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
            <SubmitButton
              size="sm"
              disabled={busy}
              pendingLabel="Approving…"
              onPendingChange={onApproving}
            >
              Approve
            </SubmitButton>
          </form>
          <form action={reject}>
            <input type="hidden" name="userId" value={id} />
            <SubmitButton
              size="sm"
              variant="secondary"
              disabled={busy}
              pendingLabel="Rejecting…"
              onPendingChange={onRejecting}
            >
              Reject
            </SubmitButton>
          </form>
        </span>
      </div>
      {message ? (
        <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] items-center border-t border-slate-200 px-5 py-[14px] text-[13.5px] text-slate-700 gap-3 max-[900px]:grid-cols-1 max-[900px]:gap-[6px]">
          <span className="rounded-xl px-[14px] py-[11px] text-[13px] bg-green-100 text-green-600" role="status">
            {message}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] items-center border-t border-slate-200 px-5 py-[14px] text-[13.5px] text-slate-700 gap-3 max-[900px]:grid-cols-1 max-[900px]:gap-[6px]">
          <span className="rounded-xl px-[14px] py-[11px] text-[13px] bg-red-100 text-red-600" role="alert">
            {error}
          </span>
        </div>
      ) : null}
    </>
  );
}
