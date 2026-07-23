"use client";

import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const suggestions = [
  "解释一下 React Server Components",
  "帮我写一个 TypeScript 工具函数",
  "给我的产品首页提三条改进建议",
];

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(reducedMotionQuery).matches;
}

function TypewriterText({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const [visibleLength, setVisibleLength] = useState(0);
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
  const safeLength = Math.min(visibleLength, text.length);
  const pendingLength = text.length - safeLength;

  useEffect(() => {
    if (visibleLength === text.length) return;

    if (reduceMotion) {
      const frame = window.requestAnimationFrame(() => {
        setVisibleLength(text.length);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const step =
      pendingLength > 120 ? 8 : pendingLength > 60 ? 4 : pendingLength > 20 ? 2 : 1;
    const delay = pendingLength > 60 ? 12 : 24;
    const timer = window.setTimeout(() => {
      setVisibleLength((currentLength) =>
        Math.min(currentLength + step, text.length),
      );
    }, delay);

    return () => window.clearTimeout(timer);
  }, [pendingLength, reduceMotion, text.length, visibleLength]);

  const isTyping = !reduceMotion && safeLength < text.length;

  return (
    <span className="typewriter-output" aria-label={text}>
      <span aria-hidden="true">
        {text.slice(0, safeLength)}
        {!reduceMotion && (active || isTyping) && (
          <span className="typewriter-cursor" />
        )}
      </span>
    </span>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error, clearError } = useChat();
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "submitted" || status === "streaming";
  const latestMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function submitMessage(text: string) {
    const message = text.trim();
    if (!message || isBusy) return;

    clearError();
    setInput("");
    await sendMessage({ text: message });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage(input);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="一二的小笨助手首页">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>一二的小笨助手</span>
        </Link>

        <div className="model-pill">
          <span className="status-dot" aria-hidden="true" />
          <span>GLM-5.2</span>
        </div>
      </header>

      <section
        className={`chat-stage ${messages.length === 0 ? "is-empty" : ""}`}
        aria-label="AI 对话"
      >
        {messages.length === 0 ? (
          <div className="welcome">
            <div className="eyebrow">
              <span className="eyebrow-line" />
              STREAMING AI
            </div>
            <h1>
              把想法说出来，
              <br />
              <em>让答案流动起来。</em>
            </h1>
            <p>
              一个由 Next.js App Router 与 Vercel AI SDK 驱动的实时对话空间。
            </p>

            <div className="suggestion-grid" aria-label="试试这些问题">
              {suggestions.map((suggestion, index) => (
                <button
                  className="suggestion-card"
                  key={suggestion}
                  type="button"
                  onClick={() => void submitMessage(suggestion)}
                >
                  <span className="suggestion-number">0{index + 1}</span>
                  <span>{suggestion}</span>
                  <span className="suggestion-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`message message-${message.role}`}
                key={message.id}
              >
                <div className="message-meta">
                  <span className="avatar" aria-hidden="true">
                    {message.role === "user" ? "你" : "AI"}
                  </span>
                  <span>
                    {message.role === "user" ? "你的问题" : "小笨助手"}
                  </span>
                </div>
                <div className="message-content">
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <p key={`${message.id}-${index}`}>
                        {message.role === "assistant" ? (
                          <TypewriterText
                            text={part.text}
                            active={isBusy && message.id === latestMessageId}
                          />
                        ) : (
                          part.text
                        )}
                      </p>
                    ) : null,
                  )}
                </div>
              </article>
            ))}

            {status === "submitted" && (
              <div className="thinking" role="status">
                <span />
                <span />
                <span />
                正在思考
              </div>
            )}

            <div ref={scrollAnchorRef} />
          </div>
        )}
      </section>

      <div className="composer-wrap">
        {error && (
          <div className="error-banner" role="alert">
            <span>连接失败，请检查 ZHIPU_API_KEY 后重试。</span>
            <button type="button" onClick={clearError}>
              关闭
            </button>
          </div>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            aria-label="输入消息"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题…"
            rows={1}
            disabled={isBusy}
          />
          {isBusy ? (
            <button
              className="send-button stop-button"
              type="button"
              onClick={stop}
              aria-label="停止生成"
            >
              <span aria-hidden="true" />
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={!input.trim()}
              aria-label="发送消息"
            >
              ↑
            </button>
          )}
        </form>
        <div className="composer-note">
          <span>Enter 发送 · Shift + Enter 换行</span>
          <span>AI 可能会犯错，请核查重要信息</span>
        </div>
      </div>
    </main>
  );
}
