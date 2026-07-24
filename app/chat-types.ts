import type { UIMessage } from "ai";

export type SearchSource = {
  id: string;
  title: string;
  url: string;
  media: string;
  publishDate: string;
  snippet: string;
  icon: string;
};

export type ChatDataParts = {
  searchSources: SearchSource[];
};

export type ChatMessage = UIMessage<unknown, ChatDataParts>;
