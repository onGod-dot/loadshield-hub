function createMetrics() {
  const state = {
    startedAt: Date.now(),
    totals: {
      allowed: 0,
      blocked: 0,
      throttled: 0,
      banned: 0,
      suspicious: 0
    },
    perSecond: [] // { t, allowed, blocked }
  };

  function tickSecond() {
    const t = Math.floor(Date.now() / 1000);
    const last = state.perSecond[state.perSecond.length - 1];
    if (!last || last.t !== t) {
      state.perSecond.push({ t, allowed: 0, blocked: 0 });
      if (state.perSecond.length > 120) state.perSecond.shift();
    }
  }

  function incAllowed() {
    tickSecond();
    state.totals.allowed++;
    state.perSecond[state.perSecond.length - 1].allowed++;
  }

  function incBlocked() {
    tickSecond();
    state.totals.blocked++;
    state.perSecond[state.perSecond.length - 1].blocked++;
  }

  function incThrottled() {
    state.totals.throttled++;
  }

  function incBanned() {
    state.totals.banned++;
  }

  function incSuspicious() {
    state.totals.suspicious++;
  }

  function snapshot(extra = {}) {
    const uptimeMs = Date.now() - state.startedAt;
    return {
      startedAt: state.startedAt,
      uptimeMs,
      totals: { ...state.totals },
      perSecond: state.perSecond.slice(),
      ...extra
    };
  }

  return {
    incAllowed,
    incBlocked,
    incThrottled,
    incBanned,
    incSuspicious,
    snapshot
  };
}

export { createMetrics };

