"use client";

import { useCallback, useState } from "react";
// React 18: `useFormState` from react-dom, not `useActionState` from react.
// It returns [state, action] only — no pending flag. See SubmitButton.
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/scout/forms/SubmitButton";
import { approveUserAction, rejectUserAction, type AdminActionState } from "../actions";
import styles from "./users.module.css";

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
      <div className={styles.row}>
        <span className={styles.name}>{name}</span>
        <span className={styles.email}>{email}</span>
        <span>{requestedAt}</span>
        <span className={styles.actions}>
          <form action={approve} className={styles.actions}>
            <input type="hidden" name="userId" value={id} />
            <label className="srOnly" htmlFor={`role-${id}`}>
              Role for {name}
            </label>
            <select id={`role-${id}`} name="role" className={styles.roleSelect} defaultValue="sales">
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
        <div className={styles.row}>
          <span className={styles.banner} role="status">
            {message}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className={styles.row}>
          <span className={`${styles.banner} ${styles.bannerError}`} role="alert">
            {error}
          </span>
        </div>
      ) : null}
    </>
  );
}
