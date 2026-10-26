export type OutputReadiness = {
  hasResult: boolean;
  busy: boolean;
  queuedFileCount: number;
  reviewCount: number;
  blockedCount: number;
  mixedMonths: boolean;
  assignedPageCount: number;
  totalPageCount: number;
  groupCount: number;
  forceDownload: boolean;
};

export function canCreateOutputs(state: OutputReadiness) {
  const packageReady = state.hasResult
    && !state.busy
    && state.queuedFileCount === 0
    && !state.mixedMonths
    && state.assignedPageCount === state.totalPageCount
    && state.groupCount > 0;
  if (!packageReady) return false;
  return state.forceDownload || (state.reviewCount === 0 && state.blockedCount === 0);
}

export function canToggleForceDownload(hasResult: boolean, busy: boolean) {
  return hasResult && !busy;
}
