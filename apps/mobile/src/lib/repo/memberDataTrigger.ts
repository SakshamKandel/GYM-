type MemberDataSyncTrigger = () => void;

let trigger: MemberDataSyncTrigger | null = null;

/** Install the background transport without coupling repository code to auth/fetch. */
export function registerMemberDataSyncTrigger(next: MemberDataSyncTrigger): () => void {
  trigger = next;
  return () => {
    if (trigger === next) trigger = null;
  };
}

/** Called only after the local transaction commits; never awaited by the UI. */
export function notifyMemberDataChanged(): void {
  trigger?.();
}
