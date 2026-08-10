export function reportClientEvent(payload: Record<string, unknown>) {
  const body = JSON.stringify(Object.assign({ at: Date.now() }, payload));
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/client/event', blob)) return;
    }
  } catch {}
  fetch('/api/client/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}
