import assert from "node:assert/strict";
import { test } from "node:test";
import { createFetchUrlTool, htmlToText } from "../src/tools/fetch-url.ts";

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response,
): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch & { urls: string[] };
  impl.urls = urls;
  return impl;
}

test("htmlToText drops tags and script bodies", () => {
  const text = htmlToText("<html><style>.x{}</style><h1>Hello</h1><script>secret()</script><p>A &amp; B</p></html>");
  assert.match(text, /Hello/);
  assert.match(text, /A & B/);
  assert.doesNotMatch(text, /secret/);
  assert.doesNotMatch(text, /<h1>/);
});

test("fetch_url returns stripped text", async () => {
  const fetchImpl = mockFetch((url, init) => {
    assert.equal(init?.redirect, "manual");
    assert.equal(url, "https://example.com/page");
    return new Response("<html><body><p>Hello there</p><script>nope()</script></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  const tool = createFetchUrlTool(fetchImpl);
  const text = await tool.execute({ url: "https://example.com/page" });
  assert.match(text, /Hello there/);
  assert.doesNotMatch(text, /nope/);
});

test("refuses non-http and private hosts before calling fetch", async () => {
  const fetchImpl = mockFetch(() => new Response("nope"));
  const tool = createFetchUrlTool(fetchImpl);
  await assert.rejects(() => tool.execute({ url: "file:///etc/passwd" }), /only http and https/);
  await assert.rejects(() => tool.execute({ url: "http://localhost/admin" }), /private address/);
  await assert.rejects(() => tool.execute({ url: "http://127.0.0.1/" }), /private address/);
  await assert.rejects(() => tool.execute({ url: "http://169.254.169.254/latest" }), /private address/);
  await assert.rejects(() => tool.execute({ url: "http://[::1]/" }), /private address/);
  assert.equal(fetchImpl.urls.length, 0);
});

test("a redirect to a private host is refused", async () => {
  const fetchImpl = mockFetch(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      }),
  );
  const tool = createFetchUrlTool(fetchImpl);
  await assert.rejects(() => tool.execute({ url: "https://example.com/start" }), /private address/);
  assert.deepEqual(fetchImpl.urls, ["https://example.com/start"]);
});

test("follows a public redirect", async () => {
  const fetchImpl = mockFetch((url) => {
    if (url === "https://example.com/start") {
      return new Response(null, {
        status: 302,
        headers: { location: "/done" },
      });
    }
    return new Response("plain words", { status: 200, headers: { "content-type": "text/plain" } });
  });
  const tool = createFetchUrlTool(fetchImpl);
  assert.equal(await tool.execute({ url: "https://example.com/start" }), "plain words");
  assert.deepEqual(fetchImpl.urls, ["https://example.com/start", "https://example.com/done"]);
});

test("HTTP errors and oversized responses throw", async () => {
  const missing = createFetchUrlTool(
    mockFetch(() => new Response("nope", { status: 404 })),
  );
  await assert.rejects(() => missing.execute({ url: "https://example.com/missing" }), /HTTP 404/);

  const huge = createFetchUrlTool(
    mockFetch(
      () => new Response("x", { status: 200, headers: { "content-length": "2000000" } }),
    ),
  );
  await assert.rejects(() => huge.execute({ url: "https://example.com/big" }), /larger than/);
});

test("long pages are truncated", async () => {
  const body = "a".repeat(13_000);
  const tool = createFetchUrlTool(
    mockFetch(() => new Response(body, { status: 200, headers: { "content-type": "text/plain" } })),
  );
  const text = String(await tool.execute({ url: "https://example.com/long" }));
  assert.match(text, /truncated to 12000 characters/);
  assert.ok(text.startsWith("a".repeat(100)));
});

test("too many redirects stop the fetch", async () => {
  const fetchImpl = mockFetch(
    () => new Response(null, { status: 302, headers: { location: "https://example.com/again" } }),
  );
  const tool = createFetchUrlTool(fetchImpl);
  await assert.rejects(() => tool.execute({ url: "https://example.com/start" }), /redirects/);
  assert.equal(fetchImpl.urls.length, 6);
});
