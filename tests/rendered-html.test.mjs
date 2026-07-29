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
  assert.match(html, /DeepSeek R1 8B/);
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
            icon: "https://docs.bigmodel.cn/favicon.ico",
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
    assert.match(stream, /data-searchSources/);
    assert.match(stream, /智谱官方联网测试/);
    assert.match(stream, /https:\/\/docs\.bigmodel\.cn\/cn\/guide\/tools\/web-search/);
    assert.equal(outboundRequests.length, 2);
    assert.match(outboundRequests[0].url, /\/web_search$/);
    assert.match(outboundRequests[1].url, /\/chat\/completions$/);

    const systemMessages = outboundRequests[1].body.messages.filter(
      (message) => message.role === "system",
    );
    assert.equal(systemMessages.length, 1);
    assert.match(systemMessages[0].content, /智谱官方联网测试/);
    assert.match(systemMessages[0].content, /每个使用到搜索资料的事实/);
    assert.match(systemMessages[0].content, /\[来源名称\]\(完整链接\)/);
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

test("routes the DeepSeek R1 model through SiliconFlow with reasoning", async () => {
  const originalApiKey = process.env.SILICONFLOW_API_KEY;
  const originalBaseUrl = process.env.SILICONFLOW_BASE_URL;
  process.env.SILICONFLOW_API_KEY = "siliconflow-test-key";
  process.env.SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "siliconflow-test",
    `${process.pid}-${Date.now()}`,
  );
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const outboundRequests = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    outboundRequests.push({ url, body });

    if (url.endsWith("/chat/completions")) {
      return new Response(
        [
          'data: {"id":"sf-test","created":1,"model":"deepseek-ai/DeepSeek-R1-0528-Qwen3-8B","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"reason-step"},"finish_reason":null}]}',
          'data: {"id":"sf-test","created":1,"model":"deepseek-ai/DeepSeek-R1-0528-Qwen3-8B","choices":[{"index":0,"delta":{"content":"answer-test"},"finish_reason":null}]}',
          'data: {"id":"sf-test","created":1,"model":"deepseek-ai/DeepSeek-R1-0528-Qwen3-8B","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}',
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
              id: "user-siliconflow-test",
              role: "user",
              parts: [{ type: "text", text: "test SiliconFlow" }],
            },
          ],
          deepThinking: true,
          webSearch: false,
          model: "deepseek-r1-0528-qwen3-8b",
        }),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        SILICONFLOW_API_KEY: "siliconflow-test-key",
        SILICONFLOW_BASE_URL: "https://api.siliconflow.cn/v1",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    const stream = await response.text();
    assert.equal(response.status, 200);
    assert.match(stream, /reason-step/);
    assert.match(stream, /answer-test/);
    assert.match(stream, /data-reasoningTiming/);
    assert.match(stream, /reasoningStartedAt/);
    assert.match(stream, /durationMs/);
    assert.equal(outboundRequests.length, 1);
    assert.match(
      outboundRequests[0].url,
      /^https:\/\/api\.siliconflow\.cn\/v1\/chat\/completions$/,
    );
    assert.equal(
      outboundRequests[0].body.model,
      "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    );
    assert.equal(outboundRequests[0].body.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.SILICONFLOW_BASE_URL;
    } else {
      process.env.SILICONFLOW_BASE_URL = originalBaseUrl;
    }
  }
});

test("routes standard SiliconFlow models with streaming content", async () => {
  const originalApiKey = process.env.SILICONFLOW_API_KEY;
  const originalBaseUrl = process.env.SILICONFLOW_BASE_URL;
  process.env.SILICONFLOW_API_KEY = "siliconflow-standard-test-key";
  process.env.SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "siliconflow-standard-test",
    `${process.pid}-${Date.now()}`,
  );
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const outboundRequests = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    outboundRequests.push({ url, body });

    if (url.endsWith("/chat/completions")) {
      return new Response(
        [
          `data: ${JSON.stringify({
            id: "sf-standard-test",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "standard-answer" },
                finish_reason: null,
              },
            ],
          })}`,
          `data: ${JSON.stringify({
            id: "sf-standard-test",
            created: 1,
            model: body.model,
            choices: [
              { index: 0, delta: {}, finish_reason: "stop" },
            ],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 2,
              total_tokens: 10,
            },
          })}`,
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

  const cases = [
    { id: "qwen3.5-4b", apiModel: "Qwen/Qwen3.5-4B" },
    { id: "hunyuan-mt-7b", apiModel: "tencent/Hunyuan-MT-7B" },
  ];

  try {
    for (const modelCase of cases) {
      const response = await worker.fetch(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                id: `user-${modelCase.id}`,
                role: "user",
                parts: [{ type: "text", text: "test SiliconFlow model" }],
              },
            ],
            deepThinking: false,
            webSearch: false,
            model: modelCase.id,
          }),
        }),
        {
          ASSETS: {
            fetch: async () => new Response("Not found", { status: 404 }),
          },
          SILICONFLOW_API_KEY: "siliconflow-standard-test-key",
          SILICONFLOW_BASE_URL: "https://api.siliconflow.cn/v1",
        },
        {
          waitUntil() {},
          passThroughOnException() {},
        },
      );

      const stream = await response.text();
      assert.equal(response.status, 200);
      assert.match(stream, /standard-answer/);
    }

    assert.equal(outboundRequests.length, cases.length);
    assert.deepEqual(
      outboundRequests.map((request) => request.body.model),
      cases.map((modelCase) => modelCase.apiModel),
    );
    assert.ok(outboundRequests.every((request) => request.body.stream));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.SILICONFLOW_BASE_URL;
    } else {
      process.env.SILICONFLOW_BASE_URL = originalBaseUrl;
    }
  }
});

test("sends raw images directly to vision-capable models", async () => {
  const originalZhipuApiKey = process.env.ZHIPU_API_KEY;
  const originalZhipuBaseUrl = process.env.ZHIPU_BASE_URL;
  const originalSiliconFlowApiKey = process.env.SILICONFLOW_API_KEY;
  const originalSiliconFlowBaseUrl = process.env.SILICONFLOW_BASE_URL;
  process.env.ZHIPU_API_KEY = "vision-zhipu-test-key";
  process.env.ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
  process.env.SILICONFLOW_API_KEY = "vision-siliconflow-test-key";
  process.env.SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("vision-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const outboundRequests = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    outboundRequests.push({ url, body });

    return new Response(
      [
        `data: ${JSON.stringify({
          id: "vision-test",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "vision-answer" },
              finish_reason: null,
            },
          ],
        })}`,
        `data: ${JSON.stringify({
          id: "vision-test",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 2,
            total_tokens: 14,
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n\n"),
      { headers: { "content-type": "text/event-stream" } },
    );
  };

  const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
  const cases = [
    { id: "glm-4.6v", apiModel: "glm-4.6v" },
    { id: "qwen3.5-4b", apiModel: "Qwen/Qwen3.5-4B" },
  ];

  try {
    for (const modelCase of cases) {
      const response = await worker.fetch(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                id: `user-vision-${modelCase.id}`,
                role: "user",
                parts: [
                  { type: "text", text: "Describe this image." },
                  {
                    type: "data-attachments",
                    data: [
                      {
                        id: `image-${modelCase.id}`,
                        name: "raw-test.png",
                        mimeType: "image/png",
                        size: 8,
                        text: "",
                        truncated: false,
                        inputMode: "vision",
                      },
                    ],
                  },
                  {
                    type: "file",
                    mediaType: "image/png",
                    filename: "raw-test.png",
                    url: imageUrl,
                  },
                ],
              },
            ],
            deepThinking: false,
            webSearch: false,
            model: modelCase.id,
          }),
        }),
        {
          ASSETS: {
            fetch: async () => new Response("Not found", { status: 404 }),
          },
          ZHIPU_API_KEY: "vision-zhipu-test-key",
          ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
          SILICONFLOW_API_KEY: "vision-siliconflow-test-key",
          SILICONFLOW_BASE_URL: "https://api.siliconflow.cn/v1",
        },
        {
          waitUntil() {},
          passThroughOnException() {},
        },
      );

      const stream = await response.text();
      assert.equal(response.status, 200);
      assert.match(stream, /vision-answer/);
    }

    assert.equal(outboundRequests.length, cases.length);
    for (const [index, request] of outboundRequests.entries()) {
      assert.equal(request.body.model, cases[index].apiModel);
      const userMessage = request.body.messages.find(
        (message) => message.role === "user",
      );
      const imagePart = userMessage.content.find(
        (part) => part.type === "image_url",
      );
      assert.equal(imagePart.image_url.url, imageUrl);
      assert.doesNotMatch(JSON.stringify(userMessage), /附件自动提取/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalZhipuApiKey === undefined) delete process.env.ZHIPU_API_KEY;
    else process.env.ZHIPU_API_KEY = originalZhipuApiKey;
    if (originalZhipuBaseUrl === undefined) delete process.env.ZHIPU_BASE_URL;
    else process.env.ZHIPU_BASE_URL = originalZhipuBaseUrl;
    if (originalSiliconFlowApiKey === undefined)
      delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = originalSiliconFlowApiKey;
    if (originalSiliconFlowBaseUrl === undefined)
      delete process.env.SILICONFLOW_BASE_URL;
    else process.env.SILICONFLOW_BASE_URL = originalSiliconFlowBaseUrl;
  }
});

test("extracts image attachments with DeepSeek OCR before chat", async () => {
  const originalApiKey = process.env.SILICONFLOW_API_KEY;
  const originalBaseUrl = process.env.SILICONFLOW_BASE_URL;
  process.env.SILICONFLOW_API_KEY = "siliconflow-ocr-test-key";
  process.env.SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ocr-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  const outboundRequests = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    outboundRequests.push({ url, body });

    return Response.json({
      model: "deepseek-ai/DeepSeek-OCR",
      choices: [
        {
          message: {
            role: "assistant",
            content:
              "<|ref|>text<|/ref|><|det|>[[0, 0, 999, 999]]<|/det|>\n# 测试文档\n\n附件正文",
          },
        },
      ],
    });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/attachments/ocr", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([137, 80, 78, 71]),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        SILICONFLOW_API_KEY: "siliconflow-ocr-test-key",
        SILICONFLOW_BASE_URL: "https://api.siliconflow.cn/v1",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.text, "# 测试文档\n\n附件正文");
    assert.equal(payload.truncated, false);
    assert.equal(outboundRequests.length, 1);
    assert.equal(
      outboundRequests[0].body.model,
      "deepseek-ai/DeepSeek-OCR",
    );
    assert.match(
      outboundRequests[0].body.messages[0].content[0].image_url.url,
      /^data:image\/png;base64,/,
    );
    assert.equal(
      outboundRequests[0].body.messages[0].content[0].image_url.detail,
      "high",
    );
    assert.match(
      outboundRequests[0].body.messages[0].content[1].text,
      /Convert the document to markdown/,
    );

    const rejectedResponse = await worker.fetch(
      new Request("http://localhost/api/attachments/ocr", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not an image",
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        SILICONFLOW_API_KEY: "siliconflow-ocr-test-key",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(rejectedResponse.status, 415);
    assert.equal(outboundRequests.length, 1);

    const oversizedResponse = await worker.fetch(
      new Request("http://localhost/api/attachments/ocr", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(10 * 1024 * 1024 + 1),
        },
        body: new Uint8Array([137, 80, 78, 71]),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
        SILICONFLOW_API_KEY: "siliconflow-ocr-test-key",
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(oversizedResponse.status, 413);
    assert.equal(outboundRequests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = originalApiKey;
    }
    if (originalBaseUrl === undefined) {
      delete process.env.SILICONFLOW_BASE_URL;
    } else {
      process.env.SILICONFLOW_BASE_URL = originalBaseUrl;
    }
  }
});

test("wires the page to a guarded UI message stream route", async () => {
  const [
    page,
    route,
    ocrRoute,
    attachmentConfig,
    attachmentPreviewStore,
    assistantPersona,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/attachments/ocr/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/attachment-config.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/attachment-preview-store.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/prompts/assistant-persona.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /useChat<ChatMessage>\(\)/);
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
  assert.match(page, /const chatStageRef = useRef<HTMLElement>/);
  assert.match(page, /const shouldFollowOutputRef = useRef\(true\)/);
  assert.match(page, /useRef\(initialTextRef\.current\)/);
  assert.match(page, /const autoScrollThreshold = 100/);
  assert.match(page, /distanceFromBottom <= autoScrollThreshold/);
  assert.match(page, /onScroll=\{handleChatScroll\}/);
  assert.match(page, /tabIndex=\{0\}/);
  assert.match(page, /container\.scrollTop = container\.scrollHeight/);
  assert.match(page, /if \(scrollFrameRef\.current !== null\) return/);
  assert.match(page, /new MutationObserver\(scrollToLatest\)/);
  assert.match(page, /characterData: true/);
  assert.doesNotMatch(page, /if \(!container \|\| !isBusy\) return/);
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
  assert.match(page, /restoreVisionFileParts/);
  assert.match(page, /stripFilePartsForStorage/);
  assert.match(page, /function ReasoningBlock/);
  assert.match(page, /type ReasoningStatus/);
  assert.match(page, /function formatReasoningDuration/);
  assert.match(page, /function getReasoningTiming/);
  assert.match(
    page,
    /思考耗时 \{formatReasoningDuration\(displayedElapsedMs\)\}/,
  );
  assert.match(page, /function AssistantMessage/);
  assert.match(page, /part\.type === "reasoning"/);
  assert.match(page, /等待思考/);
  assert.match(page, /思考中…/);
  assert.match(page, /思考完成/);
  assert.match(page, /思考已停止/);
  assert.match(page, /思考失败/);
  assert.doesNotMatch(page, /已深度思考/);
  assert.match(page, /const rawAnswerText = message\.parts/);
  assert.match(page, /cleanText: bufferedAnswerText/);
  assert.match(page, /const answerReleased =/);
  assert.match(page, /reasoningParts\.every\(\(part\) => part\.state === "done"\)/);
  assert.match(page, /answerReleased && bufferedAnswerText\.length > 0/);
  assert.match(page, /startEmpty=\{answerWasBuffered\}/);
  assert.match(
    page,
    /checked=\{modelAlwaysThinks\(selectedModel\) \|\| deepThinking\}/,
  );
  assert.match(page, /checked=\{webSearch\}/);
  assert.match(page, /modelSupportsWebSearch\(selectedModel\) && \(/);
  assert.match(page, /联网搜索/);
  assert.match(page, /请求失败，请稍后重试。/);
  assert.doesNotMatch(page, /连接失败，请检查 ZHIPU_API_KEY/);
  assert.match(page, /<GlobeHemisphereWest/);
  assert.match(page, /function SearchSourcesDrawer/);
  assert.match(page, /extractSearchActivity/);
  assert.match(page, /function SearchActivityNote/);
  assert.match(page, /className="search-activity-note"/);
  assert.match(page, /activityText: searchActivityText/);
  assert.match(page, /cleanText: questionText/);
  assert.match(page, /type SourceDrawerState/);
  assert.match(page, /part\.type === "data-searchSources"/);
  assert.match(page, /className="search-sources-trigger"/);
  assert.match(page, /className="search-drawer"/);
  assert.match(page, /className={`search-result-card/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /normalizeSourceUrl/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /className="composer-toolbar"/);
  assert.match(page, /placeholder="给一二的小笨助手发送消息"/);
  assert.match(page, /<Atom size=\{15\}/);
  assert.match(page, /<ArrowUp size=\{19\}/);
  assert.match(page, /<Paperclip size=\{19\}/);
  assert.match(page, /支持 JPEG、PNG、WebP 图片/);
  assert.match(page, /最多 \{maxAttachmentCount\} 张，每张 100 MB/);
  assert.match(page, /role="tooltip"/);
  assert.match(page, /className="attachment-tray"/);
  assert.match(page, /status: "processing"/);
  assert.match(page, /status: "ready"/);
  assert.match(page, /status: "error"/);
  assert.match(page, /disabled=\{!canSend\}/);
  assert.match(page, /type: "data-attachments" as const/);
  assert.match(page, /openPendingAttachmentPreview/);
  assert.match(page, /openStoredAttachmentPreview/);
  assert.match(page, /className="attachment-preview-dialog"/);
  assert.match(page, /minAttachmentPreviewScale = 1/);
  assert.match(page, /maxAttachmentPreviewScale = 4/);
  assert.match(page, /from "react-zoom-pan-pinch"/);
  assert.match(page, /<TransformWrapper/);
  assert.match(page, /limitToBounds=\{false\}/);
  assert.match(page, /wheel=\{\{ step: attachmentPreviewScaleStep \}\}/);
  assert.match(page, /<TransformComponent/);
  assert.match(page, /aria-label="缩小图片"/);
  assert.match(page, /aria-label="放大图片"/);
  assert.match(page, /className="attachment-preview-percent"/);
  assert.match(page, /className="attachment-preview-image"/);
  assert.match(page, /saveAttachmentPreview/);
  assert.match(page, /deleteAttachmentPreviews/);
  assert.match(page, /fetch\("\/api\/attachments\/ocr"/);
  assert.match(page, /modelSupportsImageInput/);
  assert.match(page, /visionModelIds/);
  assert.match(page, /processingMode: AttachmentInputMode/);
  assert.match(page, /type: "file" as const/);
  assert.match(page, /inputMode: attachment\.processingMode/);
  assert.match(page, /headers: \{ "Content-Type": uploadFile\.type \}/);
  assert.match(page, /body: uploadFile/);
  assert.match(page, /const responseBody = await response\.text\(\)/);
  assert.match(page, /JSON\.parse\(responseBody\)/);
  assert.match(page, /response\.status === 413/);
  assert.match(page, /单张原始图片不能超过 100 MB/);
  assert.match(page, /className="model-picker-trigger"/);
  assert.match(page, /GLM-4\.7-Flash/);
  assert.match(page, /id: "glm-4\.7-flash"/);
  assert.match(page, /GLM-4\.6V/);
  assert.match(page, /id: "glm-4\.6v"/);
  assert.match(page, /GLM-4\.5-Air/);
  assert.match(page, /id: "glm-4\.5-air"/);
  assert.match(page, /DeepSeek R1 8B/);
  assert.match(page, /id: "deepseek-r1-0528-qwen3-8b"/);
  assert.match(
    page,
    /const defaultModelId: ModelId = "deepseek-r1-0528-qwen3-8b"/,
  );
  assert.match(page, /useState<ModelId>\(defaultModelId\)/);
  assert.match(page, /className="option-label-mobile">思考/);
  assert.match(page, /className="option-label-mobile">搜索/);
  assert.match(page, /className="model-picker-label"/);
  assert.match(page, /description: "SiliconFlow · 推理模型"/);
  assert.match(page, /thinkingAlwaysOn: true/);
  assert.match(page, /id: "qwen3\.5-4b"/);
  assert.match(page, /Qwen3\.5 4B/);
  assert.match(page, /description: "SiliconFlow · 通用模型"/);
  assert.match(page, /id: "hunyuan-mt-7b"/);
  assert.match(page, /Hunyuan MT 7B/);
  assert.match(page, /description: "SiliconFlow · 翻译模型"/);
  assert.match(page, /const legacyModelId = "glm-4\.7" as const/);
  assert.match(page, /value === legacyModelId/);
  assert.doesNotMatch(page, /className="model-pill"/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(route, /process\.env\.ZHIPU_API_KEY/);
  assert.match(route, /process\.env\.SILICONFLOW_API_KEY/);
  assert.match(route, /createOpenAICompatible/);
  assert.match(route, /const messagesWithoutSearchActivity = messages\.map/);
  assert.match(route, /extractSearchActivity\(part\.text\)\.cleanText/);
  assert.match(
    route,
    /convertToModelMessages\(\s*messagesWithoutSearchActivity,\s*\{/,
  );
  assert.match(route, /createUIMessageStream<ChatMessage>/);
  assert.match(route, /createUIMessageStreamResponse\(\{ stream \}\)/);
  assert.match(route, /type: "data-searchSources"/);
  assert.match(route, /data: webSearchResult\.sources/);
  assert.match(route, /type: deepThinking \? "enabled" : "disabled"/);
  assert.match(
    route,
    /deepThinking && selectedModel === "glm-5\.2"[\s\S]*reasoningEffort: "max"/,
  );
  assert.match(route, /const webSearchModels = new Set<SupportedModel>/);
  assert.match(route, /webSearch && webSearchModels\.has\(selectedModel\)/);
  assert.match(route, /getLatestUserQuery\(messagesWithoutSearchActivity\)/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\/web_search/);
  assert.match(route, /search_query: query/);
  assert.match(route, /search_engine: "search_std"/);
  assert.match(route, /search_intent: false/);
  assert.match(route, /const webSearchResult = webSearchEnabled/);
  assert.match(route, /const systemPromptWithSearch = webSearchResult\.context/);
  assert.match(route, /import \{ assistantSystemPrompt \}/);
  assert.match(route, /system: systemPromptWithSearch/);
  assert.match(route, /messages: modelMessages/);
  assert.doesNotMatch(route, /role: "system",\s*content: webSearchResult/s);
  assert.match(route, /\[来源名称\]\(完整链接\)/);
  assert.match(route, /sendReasoning: true/);
  assert.match(route, /data-reasoningTiming/);
  assert.match(route, /chunk\.type === "reasoning-end"/);
  assert.match(route, /messageMetadata/);
  assert.match(route, /convertDataPart/);
  assert.match(route, /part\.type !== "data-attachments"/);
  assert.match(route, /const visionModels = new Set<SupportedModel>/);
  assert.match(route, /validateImageParts/);
  assert.match(route, /visionEnabled \|\| part\.type !== "file"/);
  assert.match(route, /attachment\.inputMode !== "vision"/);
  assert.match(route, /export const maxDuration = 120/);
  assert.match(route, /附件自动提取/);
  assert.match(assistantPersona, /export const assistantPersona/);
  assert.match(assistantPersona, /export const assistantSystemPrompt/);
  assert.match(assistantPersona, /回答支持 Markdown/);
  assert.match(attachmentPreviewStore, /indexedDB\.open/);
  assert.match(attachmentPreviewStore, /export async function saveAttachmentPreview/);
  assert.match(attachmentPreviewStore, /export async function getAttachmentPreview/);
  assert.match(
    attachmentPreviewStore,
    /export async function deleteAttachmentPreviews/,
  );
  assert.match(
    route,
    /const supportedModels = \[[\s\S]*"glm-5\.2",[\s\S]*"glm-4\.7-flash",[\s\S]*"glm-4\.6v",[\s\S]*"glm-4\.5-air",[\s\S]*"deepseek-r1-0528-qwen3-8b",[\s\S]*"qwen3\.5-4b",[\s\S]*"hunyuan-mt-7b",[\s\S]*\] as const/,
  );
  assert.match(
    route,
    /apiModel: "deepseek-ai\/DeepSeek-R1-0528-Qwen3-8B"/,
  );
  assert.match(route, /apiModel: "Qwen\/Qwen3\.5-4B"/);
  assert.match(route, /apiModel: "tencent\/Hunyuan-MT-7B"/);
  assert.match(route, /https:\/\/api\.siliconflow\.cn\/v1/);
  assert.match(route, /model: provider\(selectedModelConfig\.apiModel\)/);
  assert.match(
    route,
    /const defaultModel: SupportedModel = "deepseek-r1-0528-qwen3-8b"/,
  );
  assert.match(route, /The selected model is not supported/);
  assert.match(route, /https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(packageJson, /"@ai-sdk\/openai-compatible"/);
  assert.match(packageJson, /"@ai-sdk\/react"/);
  assert.match(packageJson, /"ai"/);
  assert.match(packageJson, /"streamdown"/);
  assert.match(packageJson, /"@phosphor-icons\/react"/);
  assert.match(packageJson, /"react-zoom-pan-pinch"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(ocrRoute, /deepseek-ai\/DeepSeek-OCR/);
  assert.match(ocrRoute, /request\.arrayBuffer\(\)/);
  assert.match(ocrRoute, /data:\$\{mimeType\};base64/);
  assert.match(ocrRoute, /detail: "high"/);
  assert.match(ocrRoute, /Convert the document to markdown/);
  assert.match(ocrRoute, /maxAttachmentUploadBytes/);
  assert.match(attachmentConfig, /maxAttachmentSourceBytes = 100 \* 1024 \* 1024/);
  assert.match(attachmentConfig, /maxAttachmentCount = 4/);

  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /\.message-user \.message-content\s*\{[^}]*text-align: right/s);
  assert.match(styles, /\.message-list\s*\{[^}]*padding: 54px 0 20px/s);
  assert.doesNotMatch(styles, /padding: 54px 0 160px/);
  assert.match(styles, /\.message-user \.message-content\s*\{[^}]*font-weight: 400/s);
  assert.match(styles, /\.message-user\s*\{[^}]*background: rgba\(255, 226, 197, 0\.9\)/s);
  assert.match(styles, /\.message-assistant\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.message-assistant\s*\{[^}]*box-shadow: none/s);
  assert.match(styles, /\.answer-markdown h1/);
  assert.match(styles, /\.answer-markdown h2/);
  assert.match(styles, /\.answer-markdown strong/);
  assert.match(styles, /color: #382520/);
  assert.match(styles, /0 0 6px rgba\(255, 250, 240, 0\.38\)/);
  assert.match(styles, /\.answer-markdown pre[\s\S]*text-shadow: none/);
  assert.match(styles, /\.answer-markdown a:hover/);
  assert.match(styles, /\.search-sources-trigger/);
  assert.match(styles, /\.search-activity-note/);
  assert.match(styles, /\.search-activity-label/);
  assert.match(styles, /\.search-drawer\s*\{/);
  assert.match(styles, /\.search-result-card\.is-active/);
  assert.match(styles, /@keyframes search-drawer-in/);
  assert.match(styles, /\.composer-toolbar/);
  assert.match(styles, /\.attachment-tray/);
  assert.match(styles, /\.attachment-progress svg/);
  assert.match(styles, /\.attachment-ready-badge/);
  assert.match(styles, /@keyframes attachment-spin/);
  assert.match(styles, /\.attachment-button/);
  assert.match(styles, /\.attachment-tooltip/);
  assert.match(styles, /\.attachment-button-wrap:hover \.attachment-tooltip/);
  assert.doesNotMatch(styles, /\.composer-wrap::before/);
  assert.match(styles, /\.model-picker-trigger/);
  assert.match(styles, /\.model-menu-item\.is-selected/);
  assert.match(styles, /\.thinking-option:has\(input:checked\)/);
  assert.match(styles, /\.search-option:has\(input:checked\)/);
  assert.match(styles, /\.reasoning-thinking \.reasoning-status/);
  assert.match(styles, /\.reasoning-duration/);
  assert.match(styles, /font-variant-numeric: tabular-nums/);
  assert.match(styles, /white-space: nowrap/);
  assert.match(styles, /body\s*\{[\s\S]*overflow: hidden/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*height: 100dvh/);
  assert.match(styles, /\.app-shell\s*\{[\s\S]*overflow: hidden/);
  assert.match(styles, /\.chat-stage\s*\{[\s\S]*overflow-y: auto/);
  assert.match(styles, /overscroll-behavior-y: contain/);
  assert.match(styles, /scrollbar-width: none/);
  assert.match(styles, /\.chat-stage::\-webkit-scrollbar/);
  assert.match(styles, /-webkit-overflow-scrolling: touch/);
  assert.match(styles, /@keyframes reasoning-pulse/);

  await assert.rejects(
    access(new URL("../app/_sites-preview", templateRoot)),
  );
  await access(new URL("public/brand-icon.png", templateRoot));
  await access(new URL("public/assistant-avatar.png", templateRoot));
  await access(new URL("public/user-avatar.png", templateRoot));
});
