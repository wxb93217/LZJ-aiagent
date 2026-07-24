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

test("streams an answer after adding web search context", async () => {
  const originalApiKey = process.env.ZHIPU_API_KEY;
  const originalBaseUrl = process.env.ZHIPU_BASE_URL;
  process.env.ZHIPU_API_KEY = "test-key";
  process.env.ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("search-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const outboundRequests = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    outboundRequests.push({ url, body });

    if (url.endsWith("/web_search")) {
      return Response.json({
        search_result: [
          {
            title: "智谱官方联网测试",
            content: "联网搜索已返回可验证结果。",
            link: "https://docs.bigmodel.cn/cn/guide/tools/web-search",
            media: "智谱开放文档",
            publish_date: "2026-07-24",
          },
        ],
      });
    }

    if (url.endsWith("/chat/completions")) {
      return new Response(
        [
          'data: {"id":"chat-test","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"role":"assistant","content":"联网正常"},"finish_reason":null}]}',
          'data: {"id":"chat-test","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    }

    throw new Error(`Unexpected outbound request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "user-search-test",
              role: "user",
              parts: [{ type: "text", text: "测试联网搜索" }],
            },
          ],
          deepThinking: false,
          webSearch: true,
          model: "glm-5.2",
        }),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        ZHIPU_API_KEY: "test-key",
        ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    const stream = await response.text();
    assert.equal(response.status, 200);
    assert.match(stream, /联网正常/);
    assert.equal(outboundRequests.length, 2);
    assert.match(outboundRequests[0].url, /\/web_search$/);
    assert.match(outboundRequests[1].url, /\/chat\/completions$/);

    const systemMessages = outboundRequests[1].body.messages.filter(
      (message) => message.role === "system",
    );
    assert.equal(systemMessages.length, 1);
    assert.match(systemMessages[0].content, /智谱官方联网测试/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.ZHIPU_API_KEY;
    } else {
      process.env.ZHIPU_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.ZHIPU_BASE_URL;
    } else {
      process.env.ZHIPU_BASE_URL = originalBaseUrl;
    }
  }
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
  assert.match(page, /webSearch: modelSupportsWebSearch\(selectedModel\) && webSearch/);
  assert.match(page, /model: selectedModel/);
  assert.match(page, /status === "streaming"/);
  assert.match(page, /function TypewriterText/);
  assert.match(page, /import \{ Streamdown \} from "streamdown"/);
  assert.match(page, /className="answer-markdown-content"/);
  assert.match(page, /caret="block"/);
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
  assert.match(page, /type ReasoningStatus/);
  assert.match(page, /function AssistantMessage/);
  assert.match(page, /part\.type === "reasoning"/);
  assert.match(page, /等待思考/);
  assert.match(page, /思考中…/);
  assert.match(page, /思考完成/);
  assert.match(page, /思考已停止/);
  assert.match(page, /思考失败/);
  assert.doesNotMatch(page, /已深度思考/);
  assert.match(page, /const bufferedAnswerText = message\.parts/);
  assert.match(page, /const answerReleased =/);
  assert.match(page, /reasoningParts\.every\(\(part\) => part\.state === "done"\)/);
  assert.match(page, /answerReleased && bufferedAnswerText\.length > 0/);
  assert.match(page, /startEmpty=\{answerWasBuffered\}/);
  assert.match(page, /checked=\{deepThinking\}/);
  assert.match(page, /checked=\{webSearch\}/);
  assert.match(page, /modelSupportsWebSearch\(selectedModel\) && \(/);
  assert.match(page, /联网搜索/);
  assert.match(page, /请求失败，请稍后重试。/);
  assert.doesNotMatch(page, /连接失败，请检查 ZHIPU_API_KEY/);
  assert.match(page, /<GlobeHemisphereWest/);
  assert.match(page, /className="composer-toolbar"/);
  assert.match(page, /placeholder="给一二的小笨助手发送消息"/);
  assert.match(page, /<Atom size=\{15\}/);
  assert.match(page, /<ArrowUp size=\{19\}/);
  assert.match(page, /className="model-picker-trigger"/);
  assert.match(page, /GLM-4\.7-Flash/);
  assert.match(page, /id: "glm-4\.7-flash"/);
  assert.match(page, /const legacyModelId = "glm-4\.7" as const/);
  assert.match(page, /value === legacyModelId/);
  assert.doesNotMatch(page, /className="model-pill"/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(route, /process\.env\.ZHIPU_API_KEY/);
  assert.match(route, /createOpenAICompatible/);
  assert.match(route, /convertToModelMessages\(messages\)/);
  assert.match(route, /toUIMessageStreamResponse/);
  assert.match(route, /type: deepThinking \? "enabled" : "disabled"/);
  assert.match(route, /reasoningEffort: "max"/);
  assert.match(route, /const webSearchModels = new Set<SupportedModel>/);
  assert.match(route, /webSearch && webSearchModels\.has\(selectedModel\)/);
  assert.match(route, /getLatestUserQuery\(messages\)/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\/web_search/);
  assert.match(route, /search_query: query/);
  assert.match(route, /search_engine: "search_std"/);
  assert.match(route, /search_intent: false/);
  assert.match(route, /const webSearchContext = webSearchEnabled/);
  assert.match(route, /const systemPromptWithSearch = webSearchContext/);
  assert.match(route, /system: systemPromptWithSearch/);
  assert.match(route, /messages: modelMessages/);
  assert.doesNotMatch(route, /role: "system",\s*content: webSearchContext/s);
  assert.match(route, /Markdown 链接标注来源/);
  assert.match(route, /sendReasoning: true/);
  assert.match(route, /回答支持 Markdown/);
  assert.match(
    route,
    /const supportedModels = \["glm-5\.2", "glm-4\.7-flash"\]/,
  );
  assert.match(route, /model: glm\(selectedModel\)/);
  assert.match(route, /The selected model is not supported/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(packageJson, /"@ai-sdk\/openai-compatible"/);
  assert.match(packageJson, /"@ai-sdk\/react"/);
  assert.match(packageJson, /"ai"/);
  assert.match(packageJson, /"streamdown"/);
  assert.match(packageJson, /"@phosphor-icons\/react"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /\.message-user \.message-content\s*\{[^}]*text-align: right/s);
  assert.match(styles, /\.message-user \.message-content\s*\{[^}]*font-weight: 400/s);
  assert.match(styles, /\.message-user\s*\{[^}]*background: rgba\(255, 226, 197, 0\.9\)/s);
  assert.match(styles, /\.message-assistant\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.message-assistant\s*\{[^}]*box-shadow: none/s);
  assert.match(styles, /\.answer-markdown h1/);
  assert.match(styles, /\.answer-markdown h2/);
  assert.match(styles, /\.answer-markdown strong/);
  assert.match(styles, /\.composer-toolbar/);
  assert.match(styles, /\.model-picker-trigger/);
  assert.match(styles, /\.model-menu-item\.is-selected/);
  assert.match(styles, /\.thinking-option:has\(input:checked\)/);
  assert.match(styles, /\.search-option:has\(input:checked\)/);
  assert.match(styles, /\.reasoning-thinking \.reasoning-status/);
  assert.match(styles, /@keyframes reasoning-pulse/);

  await assert.rejects(
    access(new URL("../app/_sites-preview", templateRoot)),
  );
  await access(new URL("public/brand-icon.png", templateRoot));
  await access(new URL("public/assistant-avatar.png", templateRoot));
  await access(new URL("public/user-avatar.png", templateRoot));
});
