import * as React from 'react';

export type OverlayHistoryLayer = {
  kind: string;
  id?: string;
  title?: string;
  workshopType?: string;
  src?: string;
  status?: string;
  message?: string;
};

const OVERLAY_HISTORY_STATE_KEY = '__wallhubOverlayHistory';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function normalizeLayer(value: unknown): OverlayHistoryLayer | null {
  if (!isRecord(value)) return null;
  const kind = optionalText(value.kind);
  if (!kind) return null;
  return {
    kind,
    id: optionalText(value.id),
    title: optionalText(value.title),
    workshopType: optionalText(value.workshopType),
    src: optionalText(value.src),
    status: optionalText(value.status),
    message: optionalText(value.message),
  };
}

function readLayers(state: unknown): OverlayHistoryLayer[] {
  if (!isRecord(state)) return [];
  const stored = state[OVERLAY_HISTORY_STATE_KEY];
  if (!isRecord(stored) || !Array.isArray(stored.layers)) return [];
  return stored.layers.map(normalizeLayer).filter((layer): layer is OverlayHistoryLayer => !!layer);
}

function sameLayer(left: OverlayHistoryLayer, right: OverlayHistoryLayer) {
  return left.kind === right.kind
    && left.id === right.id
    && left.title === right.title
    && left.workshopType === right.workshopType
    && left.src === right.src
    && left.status === right.status
    && left.message === right.message;
}

function sameLayers(left: OverlayHistoryLayer[], right: OverlayHistoryLayer[]) {
  return left.length === right.length && left.every((layer, index) => sameLayer(layer, right[index]));
}

function isPrefix(prefix: OverlayHistoryLayer[], layers: OverlayHistoryLayer[]) {
  return prefix.length <= layers.length && prefix.every((layer, index) => sameLayer(layer, layers[index]));
}

function historyStateFor(layers: OverlayHistoryLayer[]) {
  const current = window.history.state;
  const next = isRecord(current) ? { ...current } : {};
  if (!layers.length) {
    delete next[OVERLAY_HISTORY_STATE_KEY];
    return next;
  }
  next[OVERLAY_HISTORY_STATE_KEY] = { version: 1, layers };
  return next;
}

function pushMissingLayers(current: OverlayHistoryLayer[], next: OverlayHistoryLayer[]) {
  for (let length = current.length + 1; length <= next.length; length += 1) {
    window.history.pushState(historyStateFor(next.slice(0, length)), '', window.location.href);
  }
}

export function useOverlayHistory(
  layers: OverlayHistoryLayer[],
  onRestore: (layers: OverlayHistoryLayer[]) => void,
) {
  const layersKey = JSON.stringify(layers);
  const initializedRef = React.useRef(false);
  const visibleLayersRef = React.useRef(layers);
  const browserLayersRef = React.useRef<OverlayHistoryLayer[]>([]);
  const onRestoreRef = React.useRef(onRestore);

  visibleLayersRef.current = layers;

  React.useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  React.useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const next = readLayers(event.state);
      browserLayersRef.current = next;
      if (!sameLayers(visibleLayersRef.current, next)) onRestoreRef.current(next);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  React.useEffect(() => {
    const next = layers;
    if (!initializedRef.current) {
      initializedRef.current = true;
      const current = readLayers(window.history.state);
      browserLayersRef.current = current;
      if (sameLayers(current, next)) return;
      if (isPrefix(current, next)) pushMissingLayers(current, next);
      else window.history.replaceState(historyStateFor(next), '', window.location.href);
      browserLayersRef.current = next;
      return;
    }

    const current = browserLayersRef.current;
    if (sameLayers(current, next)) return;
    if (isPrefix(current, next)) {
      pushMissingLayers(current, next);
      browserLayersRef.current = next;
      return;
    }
    if (isPrefix(next, current) && sameLayers(readLayers(window.history.state), current)) {
      window.history.go(next.length - current.length);
      return;
    }
    window.history.replaceState(historyStateFor(next), '', window.location.href);
    browserLayersRef.current = next;
  }, [layersKey]);
}
