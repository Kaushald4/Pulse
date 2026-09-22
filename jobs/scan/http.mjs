/**
 * HTTP context for the vendored providers.
 *
 * Ported from sync's `polite-http-ctx.ts` so `providers/` stays byte-identical
 * to upstream. Same fetchJson/fetchText signatures and the same thrown-error
 * shape (`.status` / `.body` / `.retryAfter`) the providers expect.
 *
 * The one difference from the providers' own `_http.mjs` context: the User
 * Agent rotates through current browser strings per request. Several boards
 * (EchoJobs among them) return 403 to an obviously-non-browser agent.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithTimeout(url, opts, consume, outerSignal) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
    method = "GET",
    body = null,
    redirect = "follow",
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The per-request timeout and the entry deadline both have to be able to cut
  // this short, so the request watches whichever fires first.
  const signal = outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal;
  try {
    const res = await fetch(url, {
      method,
      headers: { "user-agent": randomUserAgent(), ...headers },
      body,
      redirect,
      signal,
    });

    if (!res.ok) {
      const responseText = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get("retry-after");
      throw err;
    }

    // Body consumption stays inside the timer window: a server that sends
    // headers and then stalls the body would otherwise hang the caller.
    return await consume(res);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `signal` is the current entry's deadline. Every request made for that entry
 * carries it, so a board that runs out of time has its sockets closed rather
 * than left open behind an abandoned promise.
 */
export function makeHttpContext(signal) {
  return {
    transport: "http",
    fetchJson: (url, opts = {}) => fetchWithTimeout(url, opts, (res) => res.json(), signal),
    fetchText: (url, opts = {}) => fetchWithTimeout(url, opts, (res) => res.text(), signal),
  };
}
