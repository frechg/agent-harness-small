import { expectRecord, expectString } from "./args.js";
import type { Tool } from "./types.js";

const MAX_CHARS = 12_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

/**
 * Fetches a URL and returns plain text. HTML is stripped so the model is not
 * handed a wall of tags.
 *
 * Local and private addresses are refused, including after a redirect, so a
 * hosted run does not trivially request instance metadata. Hostnames are not
 * resolved before connecting: `http://127.0.0.1.nip.io/` would still get
 * through. That gap is left visible on purpose.
 */
export function createFetchUrlTool(fetchImpl: typeof fetch = globalThis.fetch): Tool {
  return {
    name: "fetch_url",
    description:
      "Fetch an http or https URL and return its text. HTML tags are removed and the text is truncated. Local and private addresses are refused.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http or https URL.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    execute(args) {
      const url = expectString(expectRecord(args), "url");
      return fetchPublicText(url, fetchImpl);
    },
  };
}

/** Exported so tests can check the stripper without a network call. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPublicText(raw: string, fetchImpl: typeof fetch): Promise<string> {
  let current = parsePublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1",
        "user-agent": "agent-harness-small/0.1",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await discard(response);
      if (!location) {
        throw new Error(`redirect ${response.status} from ${current.href} had no Location header`);
      }
      // hop 0..MAX_REDIRECTS-1 may follow. The last iteration must be a document.
      if (hop === MAX_REDIRECTS) break;
      current = parsePublicUrl(new URL(location, current).href);
      continue;
    }

    if (!response.ok) {
      await discard(response);
      throw new Error(`HTTP ${response.status} for ${current.href}`);
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      await discard(response);
      throw new Error(`response is larger than ${MAX_BYTES} bytes`);
    }

    const body = await response.text();
    const text = toPlainText(body, response.headers.get("content-type"));
    if (text.length <= MAX_CHARS) return text;
    return `${text.slice(0, MAX_CHARS)}\n\n[truncated to ${MAX_CHARS} characters]`;
  }

  throw new Error(`stopped after ${MAX_REDIRECTS} redirects`);
}

function toPlainText(body: string, contentType: string | null): string {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("html") || /^\s*</.test(body)) return htmlToText(body);
  return body.trim();
}

function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http and https URLs are allowed");
  }
  if (url.hostname === "") throw new Error("URL is missing a host");
  if (isBlockedHost(url.hostname)) {
    throw new Error(`refusing to fetch a local or private address: ${url.hostname}`);
  }
  return url;
}

function isBlockedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  // IPv4-mapped IPv6, such as ::ffff:169.254.169.254.
  const mapped = host.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1] && isBlockedIpv4(mapped[1])) return true;

  if (host.includes(":")) {
    const first = host.split(":").find((part) => part.length > 0) ?? "";
    // fc00::/7 unique local, fe80::/10 link-local.
    if (/^f[cd]/.test(first) || /^fe[89ab]/.test(first)) return true;
    return false;
  }

  return isBlockedIpv4(host);
}

function isBlockedIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is unused. A cancel failure should not hide the HTTP error.
  }
}
