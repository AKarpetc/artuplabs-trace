/** Fake requestJira: routes map "METHOD path-prefix" to handlers returning { status, body, headers } or throwing. */
export function fakeJira(routes) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const request = async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    if (!key) throw new Error(`no route for ${method} ${path}`);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const out = await routes[key]({ path, body, attempt: calls.filter((c) => c.path === path).length });
      const headers = new Map(Object.entries(out.headers ?? {}));
      return {
        ok: out.status >= 200 && out.status < 300,
        status: out.status,
        headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
        json: async () => out.body,
        arrayBuffer: async () => out.bytes ?? new ArrayBuffer(0),
      };
    } finally {
      inFlight -= 1;
    }
  };
  return { request, calls, maxInFlight: () => maxInFlight };
}
