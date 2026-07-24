"use client";

import { useChat } from "@ai-sdk/react";
import {
  ArrowSquareOut,
  ArrowUp,
  Atom,
  CaretDown,
  Check,
  Cpu,
  GlobeHemisphereWest,
  MagnifyingGlass,
  Stop,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { Streamdown } from "streamdown";
import {
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  extractSearchActivity,
  type ChatMessage,
  type SearchSource,
} from "./chat-types";

const suggestions = [
  "解释一下 React Server Components",
  "帮我写一个 TypeScript 工具函数",
  "给我的产品首页提三条改进建议",
];
const assistantName = "一二的小笨助手";
const historyStorageKey = "yier-little-assistant-history-v1";
const maxStoredConversations = 20;
const modelOptions = [
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    description: "能力更强",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.7-flash",
    label: "GLM-4.7-Flash",
    description: "免费快速",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.6v",
    label: "GLM-4.6V",
    description: "视觉理解",
    supportsWebSearch: true,
  },
  {
    id: "glm-4.5-air",
    label: "GLM-4.5-Air",
    description: "高性价比",
    supportsWebSearch: true,
  },
] as const;

type ModelId = (typeof modelOptions)[number]["id"];
const legacyModelId = "glm-4.7" as const;

function isModelId(value: unknown): value is ModelId {
  return modelOptions.some((option) => option.id === value);
}

function normalizeModelId(value: unknown): ModelId {
  if (value === legacyModelId) {
    return "glm-4.7-flash";
  }

  return isModelId(value) ? value : "glm-5.2";
}

function modelSupportsWebSearch(model: ModelId) {
  return (
    modelOptions.find((option) => option.id === model)?.supportsWebSearch ??
    false
  );
}

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
  webSearch: boolean;
  model: ModelId;
  messages: ChatMessage[];
};

type SourceDrawerState = {
  sources: SearchSource[];
  activeUrl?: string;
};

type ReasoningStatus =
  | "waiting"
  | "thinking"
  | "complete"
  | "stopped"
  | "error";

const reasoningStatusCopy: Record<
  ReasoningStatus,
  { label: string; emptyText: string }
> = {
  waiting: {
    label: "等待思考",
    emptyText: "正在连接模型，准备开始深度思考…",
  },
  thinking: {
    label: "思考中…",
    emptyText: "正在分析问题…",
  },
  complete: {
    label: "思考完成",
    emptyText: "思考已经完成。",
  },
  stopped: {
    label: "思考已停止",
    emptyText: "本次思考已停止。",
  },
  error: {
    label: "思考失败",
    emptyText: "思考过程中出现了问题，请稍后重试。",
  },
};

function createConversationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getMessageText(message: ChatMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function getConversationTitle(messages: ChatMessage[]) {
  const firstQuestion = messages.find((message) => message.role === "user");
  const text = firstQuestion
    ? extractSearchActivity(getMessageText(firstQuestion)).cleanText.trim()
    : "";
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
    (conversation.webSearch === undefined ||
      typeof conversation.webSearch === "boolean") &&
    (conversation.model === undefined ||
      isModelId(conversation.model) ||
      conversation.model === legacyModelId) &&
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
          .map((conversation) => ({
            ...conversation,
            webSearch: conversation.webSearch ?? true,
            model: normalizeModelId(conversation.model),
          }))
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

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function getSearchSources(message: ChatMessage) {
  return message.parts.flatMap((part) =>
    part.type === "data-searchSources" ? part.data : [],
  );
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
  startEmpty = false,
  markdown = false,
  onSourceClick,
}: {
  text: string;
  active: boolean;
  startEmpty?: boolean;
  markdown?: boolean;
  onSourceClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const initialTextRef = useRef(startEmpty ? "" : text);
  const [renderedText, setRenderedText] = useState(initialTextRef.current);
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
  const isAnimating = !reduceMotion && (active || hasBufferedText);

  if (markdown) {
    return (
      <div
        className="answer-markdown"
        aria-label={text}
        onClick={onSourceClick}
      >
        <div>
          <Streamdown
            className="answer-markdown-content"
            mode={isAnimating ? "streaming" : "static"}
            isAnimating={isAnimating}
            caret="block"
          >
            {visibleText}
          </Streamdown>
        </div>
      </div>
    );
  }

  return (
    <span className="typewriter-output" aria-label={text}>
      <span aria-hidden="true">
        {visibleText}
        {isAnimating && <span className="typewriter-cursor" />}
      </span>
    </span>
  );
}

function ReasoningBlock({
  text,
  status,
}: {
  text: string;
  status: ReasoningStatus;
}) {
  const active = status === "waiting" || status === "thinking";
  const [open, setOpen] = useState(active);
  const previousStatusRef = useRef(status);
  const copy = reasoningStatusCopy[status];

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const wasActive =
      previousStatus === "waiting" || previousStatus === "thinking";

    if (wasActive && !active) {
      setOpen(false);
    } else if (!wasActive && active) {
      setOpen(true);
    }

    previousStatusRef.current = status;
  }, [active, status]);

  return (
    <details
      className={`reasoning-block reasoning-${status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="reasoning-spark" aria-hidden="true">
          ✦
        </span>
        <span className="reasoning-title">{copy.label}</span>
        <span className="reasoning-status" aria-hidden="true" />
        <span className="reasoning-toggle">{open ? "收起" : "展开"}</span>
      </summary>
      <div className="reasoning-content">
        {text ? (
          <TypewriterText text={text} active={active} />
        ) : (
          <span>{copy.emptyText}</span>
        )}
      </div>
    </details>
  );
}

function SearchActivityNote({ text }: { text: string }) {
  return (
    <div className="search-activity-note" role="status">
      <GlobeHemisphereWest size={15} weight="bold" aria-hidden="true" />
      <span className="search-activity-label">联网搜索</span>
      <span className="search-activity-detail">{text}</span>
    </div>
  );
}

function AssistantMessage({
  message,
  isLatest,
  isBusy,
  thinkingExpected,
  hasError,
  onOpenSources,
}: {
  message: ChatMessage;
  isLatest: boolean;
  isBusy: boolean;
  thinkingExpected: boolean;
  hasError: boolean;
  onOpenSources: (state: SourceDrawerState) => void;
}) {
  const searchSources = getSearchSources(message);
  const reasoningParts = message.parts.filter(
    (
      part,
    ): part is Extract<
      (typeof message.parts)[number],
      { type: "reasoning" }
    > => part.type === "reasoning",
  );
  const reasoningText = reasoningParts.map((part) => part.text).join("");
  const rawAnswerText = message.parts
    .filter(
      (
        part,
      ): part is Extract<
        (typeof message.parts)[number],
        { type: "text" }
      > => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
  const {
    activityText: searchActivityText,
    cleanText: bufferedAnswerText,
  } = extractSearchActivity(rawAnswerText);
  const hasReasoning = reasoningParts.length > 0;
  const reasoningStreaming = reasoningParts.some(
    (part) => part.state === "streaming",
  );
  const reasoningComplete =
    hasReasoning &&
    reasoningParts.every((part) => part.state === "done");
  const pipelineWaiting =
    isLatest && isBusy && thinkingExpected && !reasoningComplete;
  const answerReleased =
    !thinkingExpected ||
    reasoningComplete ||
    (!isBusy && !hasReasoning);
  const [answerWasBuffered] = useState(pipelineWaiting);
  const handleSourceClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;

      const normalizedHref = normalizeSourceUrl(href);
      const matchingSource = searchSources.find(
        (source) => normalizeSourceUrl(source.url) === normalizedHref,
      );
      if (!matchingSource) return;

      event.preventDefault();
      onOpenSources({
        sources: searchSources,
        activeUrl: matchingSource.url,
      });
    },
    [onOpenSources, searchSources],
  );

  let reasoningStatus: ReasoningStatus = "complete";

  if (hasError && isLatest) {
    reasoningStatus = "error";
  } else if (reasoningStreaming) {
    reasoningStatus = isBusy ? "thinking" : "stopped";
  } else if (!reasoningComplete) {
    reasoningStatus = "waiting";
  }

  return (
    <>
      {searchActivityText && (
        <SearchActivityNote text={searchActivityText} />
      )}

      {(hasReasoning || pipelineWaiting) && (
        <ReasoningBlock text={reasoningText} status={reasoningStatus} />
      )}

      {answerReleased && bufferedAnswerText.length > 0 && (
        <article className="message message-assistant">
          <div className="message-meta">
            <span className="avatar" aria-hidden="true">
              AI
            </span>
            <span>小笨助手</span>
          </div>

          <div className="message-content">
            <p>
              <TypewriterText
                text={bufferedAnswerText}
                active={isLatest && isBusy}
                startEmpty={answerWasBuffered}
                markdown
                onSourceClick={handleSourceClick}
              />
            </p>
          </div>

          {searchSources.length > 0 && (
            <button
              className="search-sources-trigger"
              type="button"
              onClick={() => onOpenSources({ sources: searchSources })}
            >
              <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
              <span>搜索结果 {searchSources.length}</span>
              <span className="search-sources-trigger-arrow" aria-hidden="true">
                →
              </span>
            </button>
          )}
        </article>
      )}
    </>
  );
}

function SearchSourcesDrawer({
  state,
  onClose,
}: {
  state: SourceDrawerState;
  onClose: () => void;
}) {
  const activeSourceRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    activeSourceRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [state.activeUrl]);

  return (
    <>
      <button
        className="search-drawer-backdrop"
        type="button"
        aria-label="关闭搜索结果"
        onClick={onClose}
      />
      <aside
        className="search-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="搜索结果"
      >
        <div className="search-drawer-header">
          <div>
            <span className="search-drawer-eyebrow">WEB SOURCES</span>
            <h2>搜索结果</h2>
          </div>
          <button
            className="search-drawer-close"
            type="button"
            aria-label="关闭搜索结果"
            onClick={onClose}
          >
            <X size={19} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="search-drawer-list">
          {state.sources.map((source, index) => {
            const isActive =
              normalizeSourceUrl(source.url) ===
              normalizeSourceUrl(state.activeUrl ?? "");

            return (
              <a
                className={`search-result-card ${
                  isActive ? "is-active" : ""
                }`}
                href={source.url}
                key={source.id}
                ref={isActive ? activeSourceRef : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <div className="search-result-meta">
                  <span className="search-result-icon" aria-hidden="true">
                    <GlobeHemisphereWest size={15} weight="fill" />
                    {source.icon && (
                      <span
                        className="search-result-icon-image"
                        style={{
                          backgroundImage: `url(${JSON.stringify(source.icon)})`,
                        }}
                      />
                    )}
                  </span>
                  <span>{source.media || `来源 ${index + 1}`}</span>
                  {source.publishDate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <time>{source.publishDate}</time>
                    </>
                  )}
                </div>
                <strong>{source.title}</strong>
                {source.snippet && <p>{source.snippet}</p>}
                <span className="search-result-open">
                  打开原文
                  <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
                </span>
              </a>
            );
          })}
        </div>
      </aside>
    </>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [deepThinking, setDeepThinking] = useState(true);
  const [webSearch, setWebSearch] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelId>("glm-5.2");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceDrawer, setSourceDrawer] =
    useState<SourceDrawerState | null>(null);
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
  } = useChat<ChatMessage>();
  const chatStageRef = useRef<HTMLElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const isBusy = status === "submitted" || status === "streaming";
  const latestMessageId = messages[messages.length - 1]?.id;

  const persistConversation = useCallback(
    (
      conversationId: string,
      conversationMessages: ChatMessage[],
      thinkingEnabled: boolean,
      webSearchEnabled: boolean,
      model: ModelId,
    ) => {
      if (conversationMessages.length === 0) return;

      const conversation: StoredConversation = {
        id: conversationId,
        title: getConversationTitle(conversationMessages),
        updatedAt: Date.now(),
        deepThinking: thinkingEnabled,
        webSearch: webSearchEnabled,
        model,
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

  const openSourceDrawer = useCallback((state: SourceDrawerState) => {
    setSourceDrawer(state);
  }, []);

  const closeSourceDrawer = useCallback(() => {
    setSourceDrawer(null);
  }, []);

  const handleChatScroll = useCallback(
    (event: ReactUIEvent<HTMLElement>) => {
      const container = event.currentTarget;
      const distanceFromBottom =
        container.scrollHeight -
        container.scrollTop -
        container.clientHeight;
      const scrollingUp =
        container.scrollTop < previousScrollTopRef.current - 1;

      if (distanceFromBottom <= 72) {
        shouldFollowOutputRef.current = true;
      } else if (scrollingUp) {
        shouldFollowOutputRef.current = false;
      }

      previousScrollTopRef.current = container.scrollTop;
    },
    [],
  );

  const scrollToLatest = useCallback(() => {
    if (!shouldFollowOutputRef.current) return;

    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = chatStageRef.current;
      if (!container || !shouldFollowOutputRef.current) return;

      container.scrollTop = container.scrollHeight;
      previousScrollTopRef.current = container.scrollTop;
    });
  }, []);

  useEffect(() => {
    scrollToLatest();

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages, scrollToLatest, status]);

  useEffect(() => {
    const container = chatStageRef.current;
    if (!container || !isBusy) return;

    const outputObserver = new MutationObserver(scrollToLatest);
    outputObserver.observe(container, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => outputObserver.disconnect();
  }, [isBusy, scrollToLatest]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (!modelMenuOpen) return;

    const closeModelMenu = (event: MouseEvent) => {
      if (
        modelPickerRef.current &&
        !modelPickerRef.current.contains(event.target as Node)
      ) {
        setModelMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeModelMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeModelMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;

    const saveTimer = window.setTimeout(() => {
      persistConversation(
        activeConversationId,
        messages,
        deepThinking,
        webSearch,
        selectedModel,
      );
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    activeConversationId,
    deepThinking,
    messages,
    persistConversation,
    selectedModel,
    webSearch,
  ]);

  async function submitMessage(text: string) {
    const message = text.trim();
    if (!message || isBusy) return;

    shouldFollowOutputRef.current = true;

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
          webSearch: modelSupportsWebSearch(selectedModel) && webSearch,
          model: selectedModel,
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
        webSearch,
        selectedModel,
      );
    }
  }

  function startNewConversation() {
    saveCurrentConversation();
    if (isBusy) stop();
    shouldFollowOutputRef.current = true;
    previousScrollTopRef.current = 0;
    setMessages([]);
    setActiveConversationId(null);
    setInput("");
    setDeepThinking(true);
    setWebSearch(true);
    setSelectedModel("glm-5.2");
    setModelMenuOpen(false);
    setSourceDrawer(null);
    clearError();
    setHistoryOpen(false);
  }

  function openConversation(conversation: StoredConversation) {
    saveCurrentConversation();
    if (isBusy) stop();
    shouldFollowOutputRef.current = true;
    setMessages(conversation.messages);
    setActiveConversationId(conversation.id);
    setDeepThinking(conversation.deepThinking);
    setWebSearch(conversation.webSearch);
    setSelectedModel(conversation.model);
    setModelMenuOpen(false);
    setSourceDrawer(null);
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
      setWebSearch(true);
      setSelectedModel("glm-5.2");
      setModelMenuOpen(false);
      setSourceDrawer(null);
    }
  }

  return (
    <main className="app-shell">
      {sourceDrawer && (
        <SearchSourcesDrawer
          state={sourceDrawer}
          onClose={closeSourceDrawer}
        />
      )}

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
                        {modelSupportsWebSearch(conversation.model) &&
                          (conversation.webSearch ? "联网" : "未联网")}
                        {modelSupportsWebSearch(conversation.model) && (
                          <span aria-hidden="true"> · </span>
                        )}
                        {conversation.model.toUpperCase()}
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
        </div>
      </header>

      <section
        ref={chatStageRef}
        className={`chat-stage ${messages.length === 0 ? "is-empty" : ""}`}
        aria-label="AI 对话"
        onScroll={handleChatScroll}
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
            {messages.map((message) => {
              const isLatest = message.id === latestMessageId;

              if (message.role === "assistant") {
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLatest={isLatest}
                    isBusy={isBusy}
                    thinkingExpected={deepThinking}
                    hasError={Boolean(error)}
                    onOpenSources={openSourceDrawer}
                  />
                );
              }

              const rawQuestionText = message.parts
                .filter(
                  (
                    part,
                  ): part is Extract<
                    (typeof message.parts)[number],
                    { type: "text" }
                  > => part.type === "text",
                )
                .map((part) => part.text)
                .join("\n");
              const {
                activityText: searchActivityText,
                cleanText: questionText,
              } = extractSearchActivity(rawQuestionText);

              return (
                <div className="user-message-group" key={message.id}>
                  <article
                    className={`message message-${message.role}`}
                  >
                    <div className="message-meta">
                      <span className="avatar" aria-hidden="true">
                        你
                      </span>
                      <span>你的问题</span>
                    </div>

                    <div className="message-content">
                      <p>{questionText}</p>
                    </div>
                  </article>

                  {searchActivityText && (
                    <SearchActivityNote text={searchActivityText} />
                  )}
                </div>
              );
            })}

            {status === "submitted" && deepThinking && (
              <ReasoningBlock
                text=""
                status="waiting"
              />
            )}

            {status === "error" &&
              deepThinking &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <ReasoningBlock text="" status="error" />
              )}

            <div aria-hidden="true" />
          </div>
        )}
      </section>

      <div className="composer-wrap">
        {error && (
          <div className="error-banner" role="alert">
            <span>请求失败，请稍后重试。</span>
            <button type="button" onClick={clearError}>
              关闭
            </button>
          </div>
        )}

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            ref={composerTextareaRef}
            aria-label="输入消息"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="给一二的小笨助手发送消息"
            rows={2}
            disabled={isBusy}
          />

          <div className="composer-toolbar">
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
                <Atom size={15} weight="bold" aria-hidden="true" />
                <span>深度思考</span>
              </label>
              {modelSupportsWebSearch(selectedModel) && (
                <label className="thinking-option search-option">
                  <input
                    type="checkbox"
                    checked={webSearch}
                    disabled={isBusy}
                    onChange={(event) => setWebSearch(event.target.checked)}
                  />
                  <GlobeHemisphereWest
                    size={15}
                    weight="bold"
                    aria-hidden="true"
                  />
                  <span>联网搜索</span>
                </label>
              )}
            </div>

            <div className="composer-actions">
              <div className="model-picker" ref={modelPickerRef}>
                {modelMenuOpen && (
                  <div
                    className="model-menu"
                    role="listbox"
                    aria-label="选择对话模型"
                  >
                    <div className="model-menu-heading">选择模型</div>
                    {modelOptions.map((option) => {
                      const isSelected = selectedModel === option.id;

                      return (
                        <button
                          className={`model-menu-item ${
                            isSelected ? "is-selected" : ""
                          }`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          key={option.id}
                          onClick={() => {
                            setSelectedModel(option.id);
                            setModelMenuOpen(false);
                          }}
                        >
                          <span className="model-menu-icon" aria-hidden="true">
                            <Cpu size={17} weight="bold" />
                          </span>
                          <span className="model-menu-copy">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                          {isSelected && (
                            <Check
                              className="model-menu-check"
                              size={16}
                              weight="bold"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  className="model-picker-trigger"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  disabled={isBusy}
                  onClick={() => setModelMenuOpen((open) => !open)}
                >
                  <Cpu size={15} weight="bold" aria-hidden="true" />
                  <span>{selectedModel.toUpperCase()}</span>
                  <CaretDown
                    className={modelMenuOpen ? "is-open" : ""}
                    size={13}
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
              </div>

              {isBusy ? (
                <button
                  className="send-button stop-button"
                  type="button"
                  onClick={stop}
                  aria-label="停止生成"
                >
                  <Stop size={14} weight="fill" aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="发送消息"
                >
                  <ArrowUp size={19} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
