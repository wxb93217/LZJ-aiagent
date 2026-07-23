import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the streaming chat shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>流光对话 — Streaming AI Chat<\/title>/i);
  assert.match(html, /把想法说出来/);
  assert.match(html, /让答案流动起来/);
  assert.match(html, /GLM-5\.2/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("wires the page to a guarded UI message stream route", async () => {
  const [page, route, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useChat\(\)/);
  assert.match(page, /sendMessage\(\{ text: message \}\)/);
  assert.match(page, /status === "streaming"/);
  assert.match(route, /process\.env\.ZHIPU_API_KEY/);
  assert.match(route, /createOpenAICompatible/);
  assert.match(route, /convertToModelMessages\(messages\)/);
  assert.match(route, /toUIMessageStreamResponse/);
  assert.match(route, /process\.env\.GLM_MODEL \?\? "glm-5\.2"/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(packageJson, /"@ai-sdk\/openai-compatible"/);
  assert.match(packageJson, /"@ai-sdk\/react"/);
  assert.match(packageJson, /"ai"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("../app/_sites-preview", templateRoot)),
  );
});
