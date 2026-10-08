import { useState, type Dispatch, type SetStateAction } from "react";

// Local copy of a server-provided prop: edits can patch it at once, and a new
// prop (after router.refresh()) replaces it, so server data always wins later.
// The reset happens during render (no effect), so there is no stale flash.
export function useSyncedState<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => prop);
  const [seen, setSeen] = useState<T>(() => prop);
  if (seen !== prop) {
    setSeen(() => prop);
    setValue(() => prop);
  }
  return [value, setValue];
}
