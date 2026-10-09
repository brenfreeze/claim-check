// Makes any network call during an offline check visible. The default check path must never touch the network;
// while a section is open every fetch/XHR is recorded (and logged in dev) so a regression shows up in Metro.
type Section = { label: string; calls: string[] };

const open = new Set<Section>();
let xhrInstalled = false;
const GUARDED = Symbol.for('claimcheck.netGuard');

function record(url: string) {
  for (const s of open) {
    s.calls.push(url);
    if (typeof __DEV__ === 'undefined' || __DEV__) console.log(`[net-guard] network call during ${s.label}:`, url);
  }
}

/** Wraps fetch (again, if something replaced it since) and XHR once. */
function install() {
  const g = globalThis as { fetch?: typeof fetch; XMLHttpRequest?: { prototype: { open: (...a: unknown[]) => void } } };
  const realFetch = g.fetch;
  if (realFetch && !(realFetch as unknown as Record<symbol, boolean>)[GUARDED]) {
    const guarded = ((input: RequestInfo | URL, init?: RequestInit) => {
      record(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return realFetch(input, init);
    }) as typeof fetch;
    (guarded as unknown as Record<symbol, boolean>)[GUARDED] = true;
    g.fetch = guarded;
  }
  const xhr = g.XMLHttpRequest?.prototype;
  if (xhr && !xhrInstalled) {
    xhrInstalled = true;
    const realOpen = xhr.open;
    xhr.open = function (this: unknown, ...args: unknown[]) {
      record(String(args[1]));
      return realOpen.apply(this, args);
    };
  }
}

/** Opens a guarded section; call the returned function when it ends to get the calls made inside it. */
export function beginOfflineSection(label: string): () => string[] {
  install();
  const s: Section = { label, calls: [] };
  open.add(s);
  return () => {
    open.delete(s);
    return s.calls;
  };
}
