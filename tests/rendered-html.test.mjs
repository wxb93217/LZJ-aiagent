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
  assert.match(html, /<title>一二的小笨助手 — Streaming AI Chat<\/title>/i);
  assert.match(html, /一二的小笨助手/);
  assert.match(html, /一个小笨AI想要回答一二完成各种问题/);
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
  assert.match(page, /sendMessage\(/);
  assert.match(page, /body:\s*\{\s*deepThinking/);
  assert.match(page, /status === "streaming"/);
  assert.match(page, /function TypewriterText/);
  assert.match(page, /useSyncExternalStore/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /cancelAnimationFrame/);
  assert.match(page, /targetTextRef/);
  assert.match(page, /renderedTextRef/);
  assert.match(page, /charactersPerFrame/);
  assert.match(page, /punctuationPauseFramesRef/);
  assert.match(page, /punctuationPattern/);
  assert.doesNotMatch(page, /setInterval/);
  assert.doesNotMatch(page, /\}, 50\)/);
  assert.match(page, /className="brand-icon"/);
  assert.match(page, /className={`title-character title-character-/);
  assert.match(page, /historyStorageKey/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /setMessages\(conversation\.messages\)/);
  assert.match(page, /function ReasoningBlock/);
  assert.match(page, /part\.type === "reasoning"/);
  assert.match(page, /思考过程/);
  assert.doesNotMatch(page, /已深度思考/);
  assert.match(page, /message\.role === "assistant" && reasoningText/);
  assert.match(page, /const answerParts = message\.parts\.filter/);
  assert.match(page, /message\.role !== "assistant" \|\| hasAnswerContent/);
  assert.match(page, /checked=\{deepThinking\}/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(route, /process\.env\.ZHIPU_API_KEY/);
  assert.match(route, /createOpenAICompatible/);
  assert.match(route, /convertToModelMessages\(messages\)/);
  assert.match(route, /toUIMessageStreamResponse/);
  assert.match(route, /type: deepThinking \? "enabled" : "disabled"/);
  assert.match(route, /reasoningEffort: "max"/);
  assert.match(route, /sendReasoning: true/);
  assert.match(route, /process\.env\.GLM_MODEL \?\? "glm-5\.2"/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(packageJson, /"@ai-sdk\/openai-compatible"/);
  assert.match(packageJson, /"@ai-sdk\/react"/);
  assert.match(packageJson, /"ai"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("../app/_sites-preview", templateRoot)),
  );
  await access(new URL("public/brand-icon.png", templateRoot));
  await access(new URL("public/assistant-avatar.png", templateRoot));
  await access(new URL("public/user-avatar.png", templateRoot));
});
