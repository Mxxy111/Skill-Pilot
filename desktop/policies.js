const DEFAULT_BOUNDS = Object.freeze({ width: 1440, height: 900 });
const MIN_BOUNDS = Object.freeze({ width: 1000, height: 700 });
const MAX_BOUNDS = Object.freeze({ width: 2560, height: 1440 });

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isAllowedAppUrl(candidate, appUrl) {
  const next = parseUrl(candidate);
  const allowed = parseUrl(appUrl);
  return Boolean(next && allowed && next.origin === allowed.origin);
}

export function isSafeExternalUrl(candidate) {
  const url = parseUrl(candidate);
  return Boolean(
    url &&
    url.protocol === 'https:' &&
    !url.username &&
    !url.password
  );
}

export function normalizeWindowBounds(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BOUNDS };
  const width = Number.isFinite(value.width) ? value.width : DEFAULT_BOUNDS.width;
  const height = Number.isFinite(value.height) ? value.height : DEFAULT_BOUNDS.height;
  return {
    width: Math.round(Math.min(MAX_BOUNDS.width, Math.max(MIN_BOUNDS.width, width))),
    height: Math.round(Math.min(MAX_BOUNDS.height, Math.max(MIN_BOUNDS.height, height)))
  };
}
