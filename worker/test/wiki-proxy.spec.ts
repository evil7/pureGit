import { describe, it, expect, vi, afterEach } from "vitest";
import { isWikiRequest, handleWikiProxy } from "../src/wiki-proxy";

describe("isWikiRequest", () => {
  it("matches /$wiki/{owner}/{repo}/{page}", () => {
    expect(isWikiRequest("/$wiki/evil7/pureGit/Home")).toBe(true);
    expect(isWikiRequest("/$wiki/evil7/pureGit/_Sidebar")).toBe(true);
    expect(isWikiRequest("/$wiki/evil7/pureGit/docs/Home")).toBe(true);
  });
  it("rejects non-wiki paths", () => {
    expect(isWikiRequest("/auth/login")).toBe(false);
    expect(isWikiRequest("/$wiki/evil7/pureGit")).toBe(false);
    expect(isWikiRequest("/$wiki/evil7")).toBe(false);
    expect(isWikiRequest("/evil7/pureGit/wiki")).toBe(false);
  });
});

describe("handleWikiProxy", () => {
  const originalFetch = globalThis.fetch;
  const env = { FRONTEND_URL: "http://127.0.0.1:5173" } as unknown as Env;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards to raw.githubusercontent.com/wiki and returns md text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Welcome\n\nHello wiki", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const req = new Request("http://localhost:8787/$wiki/evil7/pureGit/Home");
    const res = await handleWikiProxy(req, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# Welcome");
    const called = fetchMock.mock.calls[0][0] as string;
    expect(called).toBe("https://raw.githubusercontent.com/wiki/evil7/pureGit/Home.md");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
  });

  it("returns 404 for missing page", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("404: Not Found", { status: 404 })) as typeof fetch;
    const req = new Request("http://localhost:8787/$wiki/evil7/pureGit/Nope");
    const res = await handleWikiProxy(req, env);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({
      error: "wiki_page_not_found",
    });
  });

  it("rejects non-GET", async () => {
    const req = new Request("http://localhost:8787/$wiki/evil7/pureGit/Home", {
      method: "POST",
    });
    const res = await handleWikiProxy(req, env);
    expect(res.status).toBe(405);
  });

  it("returns 504 on upstream timeout", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation was aborted.", "AbortError"),
      ) as typeof fetch;
    const req = new Request("http://localhost:8787/$wiki/evil7/pureGit/Home");
    const res = await handleWikiProxy(req, env);
    expect(res.status).toBe(504);
    expect((await res.json()) as { error: string }).toEqual({
      error: "upstream_timeout",
    });
  });
});
