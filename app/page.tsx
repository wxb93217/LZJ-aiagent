"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
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
const assistantName = "一二的小笨助手";
const historyStorageKey = "yier-little-assistant-history-v1";
const maxStoredConversations = 20;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const punctuationPattern = /[，。！？；：、…—,.!?;:]/;
const historyDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type StoredConversation = {
  id: string;
  title: string;
  updatedAt: number;
  deepThinking: boolean;
  messages: UIMessage[];
};

function createConversationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getMessageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function getConversationTitle(messages: UIMessage[]) {
  const firstQuestion = messages.find((message) => message.role === "user");
  const text = firstQuestion ? getMessageText(firstQuestion).trim() : "";
  const characters = Array.from(text || "新对话");

  return `${characters.slice(0, 22).join("")}${
    characters.length > 22 ? "…" : ""
  }`;
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (typeof value !== "object" || value === null) return false;

  const conversation = value as Partial<StoredConversation>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.updatedAt === "number" &&
    typeof conversation.deepThinking === "boolean" &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        typeof message.id === "string" &&
        Array.isArray(message.parts),
    )
  );
}

function readConversationHistory() {
  if (typeof window === "undefined") return [];

  try {
    const storedValue = window.localStorage.getItem(historyStorageKey);
    const parsedValue: unknown = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue)
      ? parsedValue
          .filter(isStoredConversation)
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, maxStoredConversations)
      : [];
  } catch {
    return [];
  }
}

function writeConversationHistory(history: StoredConversation[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  } catch {
    // Browser privacy settings or a full storage quota can block local history.
  }
}

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
  const [renderedText, setRenderedText] = useState(text);
  const reduceMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );
  const targetTextRef = useRef(text);
  const renderedTextRef = useRef(text);
  const frameRef = useRef<number | null>(null);
  const punctuationPauseFramesRef = useRef(0);
  const reduceMotionRef = useRef(reduceMotion);

  targetTextRef.current = text;
  reduceMotionRef.current = reduceMotion;

  const renderFrame = useCallback(function renderFrame() {
    frameRef.current = null;

    const targetText = targetTextRef.current;
    const currentText = renderedTextRef.current;

    if (reduceMotionRef.current) {
      if (currentText !== targetText) {
        renderedTextRef.current = targetText;
        setRenderedText(targetText);
      }

      return;
    }

    if (!targetText.startsWith(currentText)) {
      renderedTextRef.current = targetText;
      punctuationPauseFramesRef.current = 0;
      setRenderedText(targetText);
      return;
    }

    const remainingCharacters = Array.from(
      targetText.slice(currentText.length),
    );

    if (remainingCharacters.length === 0) return;

    if (punctuationPauseFramesRef.current > 0) {
      punctuationPauseFramesRef.current -= 1;
      frameRef.current = window.requestAnimationFrame(renderFrame);
      return;
    }

    const charactersPerFrame =
      remainingCharacters.length > 48
        ? 3
        : remainingCharacters.length > 12
          ? 2
          : 1;
    const candidateCharacters = remainingCharacters.slice(
      0,
      charactersPerFrame,
    );
    const punctuationIndex = candidateCharacters.findIndex((character) =>
      punctuationPattern.test(character),
    );
    const takeCount =
      punctuationIndex >= 0 ? punctuationIndex + 1 : charactersPerFrame;
    const charactersToRender = remainingCharacters.slice(0, takeCount);
    const nextText = currentText + charactersToRender.join("");

    renderedTextRef.current = nextText;
    setRenderedText(nextText);

    if (
      punctuationPattern.test(
        charactersToRender[charactersToRender.length - 1] ?? "",
      )
    ) {
      punctuationPauseFramesRef.current = 1;
    }

    if (nextText !== targetTextRef.current) {
      frameRef.current = window.requestAnimationFrame(renderFrame);
    }
  }, []);

  useEffect(() => {
    if (
      frameRef.current === null &&
      renderedTextRef.current !== targetTextRef.current
    ) {
      frameRef.current = window.requestAnimationFrame(renderFrame);
    }
  }, [text, reduceMotion, renderFrame]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  const visibleText = reduceMotion ? text : renderedText;
  const hasBufferedText = !reduceMotion && renderedText !== text;

  return (
    <span className="typewriter-output" aria-label={text}>
      <span aria-hidden="true">
        {visibleText}
        {!reduceMotion && (active || hasBufferedText) && (
          <span className="typewriter-cursor" />
        )}
      </span>
    </span>
  );
}

function ReasoningBlock({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(active);

  return (
    <details
      className="reasoning-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="reasoning-spark" aria-hidden="true">
          ✦
        </span>
        <span>{active ? "思考中…" : "思考过程"}</span>
        <span className="reasoning-toggle">{open ? "收起" : "展开"}</span>
      </summary>
      <div className="reasoning-content">
        {text ? (
          <TypewriterText text={text} active={active} />
        ) : (
          <span>正在分析问题…</span>
        )}
      </div>
    </details>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [deepThinking, setDeepThinking] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationHistory, setConversationHistory] = useState<
    StoredConversation[]
  >(readConversationHistory);
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
  } = useChat();
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "submitted" || status === "streaming";
  const latestMessageId = messages[messages.length - 1]?.id;

  const persistConversation = useCallback(
    (
      conversationId: string,
      conversationMessages: UIMessage[],
      thinkingEnabled: boolean,
    ) => {
      if (conversationMessages.length === 0) return;

      const conversation: StoredConversation = {
        id: conversationId,
        title: getConversationTitle(conversationMessages),
        updatedAt: Date.now(),
        deepThinking: thinkingEnabled,
        messages: conversationMessages,
      };

      setConversationHistory((currentHistory) => {
        const nextHistory = [
          conversation,
          ...currentHistory.filter((item) => item.id !== conversationId),
        ].slice(0, maxStoredConversations);

        writeConversationHistory(nextHistory);
        return nextHistory;
      });
    },
    [],
  );

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;

    const saveTimer = window.setTimeout(() => {
      persistConversation(activeConversationId, messages, deepThinking);
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    activeConversationId,
    deepThinking,
    messages,
    persistConversation,
  ]);

  async function submitMessage(text: string) {
    const message = text.trim();
    if (!message || isBusy) return;

    const conversationId =
      activeConversationId ?? createConversationId();

    if (!activeConversationId) {
      setActiveConversationId(conversationId);
    }

    clearError();
    setInput("");
    await sendMessage(
      { text: message },
      {
        body: {
          deepThinking,
        },
      },
    );
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

  function saveCurrentConversation() {
    if (activeConversationId && messages.length > 0) {
      persistConversation(
        activeConversationId,
        messages,
        deepThinking,
      );
    }
  }

  function startNewConversation() {
    saveCurrentConversation();
    if (isBusy) stop();
    setMessages([]);
    setActiveConversationId(null);
    setInput("");
    setDeepThinking(true);
    clearError();
    setHistoryOpen(false);
  }

  function openConversation(conversation: StoredConversation) {
    saveCurrentConversation();
    if (isBusy) stop();
    setMessages(conversation.messages);
    setActiveConversationId(conversation.id);
    setDeepThinking(conversation.deepThinking);
    clearError();
    setHistoryOpen(false);
  }

  function deleteConversation(conversationId: string) {
    setConversationHistory((currentHistory) => {
      const nextHistory = currentHistory.filter(
        (conversation) => conversation.id !== conversationId,
      );
      writeConversationHistory(nextHistory);
      return nextHistory;
    });

    if (activeConversationId === conversationId) {
      if (isBusy) stop();
      setMessages([]);
      setActiveConversationId(null);
      setDeepThinking(true);
    }
  }

  return (
    <main className="app-shell">
      {historyOpen && (
        <>
          <button
            className="history-backdrop"
            type="button"
            aria-label="关闭历史对话"
            onClick={() => setHistoryOpen(false)}
          />
          <aside
            className="history-panel"
            role="dialog"
            aria-modal="true"
            aria-label="历史对话"
          >
            <div className="history-panel-header">
              <div>
                <span className="history-eyebrow">LOCAL HISTORY</span>
                <h2>历史对话</h2>
              </div>
              <button
                className="history-close"
                type="button"
                aria-label="关闭历史对话"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </button>
            </div>

            <button
              className="new-chat-button"
              type="button"
              onClick={startNewConversation}
            >
              <span aria-hidden="true">＋</span>
              新对话
            </button>

            <div className="history-list">
              {conversationHistory.length > 0 ? (
                conversationHistory.map((conversation) => (
                  <div
                    className={`history-item ${
                      conversation.id === activeConversationId
                        ? "is-active"
                        : ""
                    }`}
                    key={conversation.id}
                  >
                    <button
                      className="history-item-main"
                      type="button"
                      onClick={() => openConversation(conversation)}
                    >
                      <span className="history-title">
                        {conversation.title}
                      </span>
                      <span className="history-meta">
                        {conversation.deepThinking ? "深度思考" : "快速回答"}
                        <span aria-hidden="true"> · </span>
                        {historyDateFormatter.format(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      className="history-delete"
                      type="button"
                      aria-label={`删除对话：${conversation.title}`}
                      onClick={() => deleteConversation(conversation.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="history-empty">
                  <span aria-hidden="true">☁</span>
                  <p>还没有历史对话</p>
                  <small>开始提问后会自动保存在这里</small>
                </div>
              )}
            </div>

            <p className="history-footnote">
              对话仅保存在当前浏览器，最多保留 20 条
            </p>
          </aside>
        </>
      )}

      <header className="topbar">
        <Link className="brand" href="/" aria-label="一二的小笨助手首页">
          <span className="brand-icon" aria-hidden="true" />
          <span>一二的小笨助手</span>
        </Link>

        <div className="topbar-actions">
          <button
            className="history-trigger"
            type="button"
            onClick={() => setHistoryOpen(true)}
          >
            <span aria-hidden="true">◷</span>
            <span>历史对话</span>
          </button>
          <div className="model-pill">
            <span className="status-dot" aria-hidden="true" />
            <span>GLM-5.2</span>
          </div>
        </div>
      </header>

      <section
        className={`chat-stage ${messages.length === 0 ? "is-empty" : ""}`}
        aria-label="AI 对话"
      >
        {messages.length === 0 ? (
          <div className="welcome">
            <h1 aria-label={assistantName}>
              {Array.from(assistantName).map((character, index) => (
                <span
                  aria-hidden="true"
                  className={`title-character title-character-${index + 1}`}
                  key={`${character}-${index}`}
                >
                  {character}
                </span>
              ))}
            </h1>
            <p>一个小笨AI想要回答一二完成各种问题</p>

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
                  {message.parts.map((part, index) => {
                    const partKey = `${message.id}-${index}`;

                    if (part.type === "reasoning") {
                      return (
                        <ReasoningBlock
                          key={partKey}
                          text={part.text}
                          active={
                            isBusy &&
                            message.id === latestMessageId &&
                            part.state === "streaming"
                          }
                        />
                      );
                    }

                    if (part.type === "text") {
                      return (
                        <p key={partKey}>
                          {message.role === "assistant" ? (
                            <TypewriterText
                              text={part.text}
                              active={isBusy && message.id === latestMessageId}
                            />
                          ) : (
                            part.text
                          )}
                        </p>
                      );
                    }

                    return null;
                  })}
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
          <div className="composer-field">
            <textarea
              aria-label="输入消息"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的问题…"
              rows={1}
              disabled={isBusy}
            />
            <div className="composer-options">
              <label className="thinking-option">
                <input
                  type="checkbox"
                  checked={deepThinking}
                  disabled={isBusy}
                  onChange={(event) =>
                    setDeepThinking(event.target.checked)
                  }
                />
                <span className="thinking-checkbox" aria-hidden="true">
                  {deepThinking ? "✓" : ""}
                </span>
                <span>深度思考</span>
              </label>
            </div>
          </div>
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
