import { describe, it, expect, vi, afterEach } from "vitest";
import { isGitRequest, rewriteGitUrl, handleGitProxy } from "../src/git-proxy";

describe("isGitRequest", () => {
  it("matches git smart HTTP endpoints", () => {
    expect(isGitRequest("/owner/repo.git/info/refs")).toBe(true);
    expect(isGitRequest("/owner/repo.git/git-upload-pack")).toBe(true);
    expect(isGitRequest("/owner/repo.git/git-receive-pack")).toBe(true);
    expect(isGitRequest("/owner/repo/info/refs")).toBe(true);
    expect(isGitRequest("/owner/repo/git-upload-pack")).toBe(true);
  });

  it("rejects non-git paths", () => {
    expect(isGitRequest("/auth/login")).toBe(false);
    expect(isGitRequest("/owner/repo")).toBe(false);
    expect(isGitRequest("/owner/repo/tree/main")).toBe(false);
    expect(isGitRequest("/owner/repo/archive/refs/heads/main.zip")).toBe(false);
    expect(isGitRequest("/")).toBe(false);
  });
});

describe("rewriteGitUrl", () => {
  it("preserves path and query, rewrites host to github.com", () => {
    const u = new URL(
      "http://localhost:8787/microsoft/vscode.git/info/refs?service=git-upload-pack",
    );
    const target = rewriteGitUrl(u);
    expect(target.host).toBe("github.com");
    expect(target.pathname).toBe("/microsoft/vscode.git/info/refs");
    expect(target.searchParams.get("service")).toBe("git-upload-pack");
  });
});

describe("handleGitProxy", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards GET info/refs to github.com and streams response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# service=git-upload-pack\n", {
        status: 200,
        headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
      }),
    );
    globalThis.fetch = fetchMock;

    const req = new Request(
      "http://localhost:8787/microsoft/vscode.git/info/refs?service=git-upload-pack",
      { headers: { Accept: "*/*" } },
    );
    const resp = await handleGitProxy(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(targetUrl).toBe(
      "https://github.com/microsoft/vscode.git/info/refs?service=git-upload-pack",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    // 透传 Accept，移除 host
    const h = new Headers(init.headers);
    expect(h.get("Accept")).toBe("*/*");
    expect(h.has("host")).toBe(false);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/x-git-upload-pack-advertisement");
    expect(await resp.text()).toContain("git-upload-pack");
  });

  it("forwards POST git-receive-pack with body and Authorization (PAT)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("pack-data", { status: 200 }));
    globalThis.fetch = fetchMock;

    const req = new Request("http://localhost:8787/owner/repo.git/git-receive-pack", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-git-receive-pack-request",
        Authorization: "Basic cGF0OnBhdA==", // pat:pat
      },
      body: "some-binary-pack-data",
    });
    const resp = await handleGitProxy(req);

    const [targetUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(targetUrl).toBe("https://github.com/owner/repo.git/git-receive-pack");
    expect(init.method).toBe("POST");
    expect(await new Response(init.body as BodyInit).text()).toBe("some-binary-pack-data");
    const h = new Headers(init.headers);
    expect(h.get("Content-Type")).toBe("application/x-git-receive-pack-request");
    expect(h.get("Authorization")).toBe("Basic cGF0OnBhdA==");

    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("pack-data");
  });

  it("propagates upstream error status (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    globalThis.fetch = fetchMock;

    const req = new Request(
      "http://localhost:8787/nonexistent/repo.git/info/refs?service=git-upload-pack",
    );
    const resp = await handleGitProxy(req);
    expect(resp.status).toBe(404);
    expect(await resp.text()).toBe("Not Found");
  });
});
