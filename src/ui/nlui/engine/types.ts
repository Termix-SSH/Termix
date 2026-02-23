// ---- LLM Types ----

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamChunk {
  choices?: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: Usage;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ---- Gateway Types ----

export interface AuthConfig {
  type: 'bearer' | 'header' | 'query' | '';
  headerName?: string;
  token?: string;
}

export interface ParamInfo {
  name: string;
  in: 'path' | 'query' | 'header';
  type?: string;
  required: boolean;
}

export interface Endpoint {
  targetName: string;
  targetDisplayName: string;
  baseURL: string;
  method: string;
  path: string;
  auth: AuthConfig;
  params: ParamInfo[];
  hasBody: boolean;
}

export interface TargetConfig {
  name: string;
  baseURL?: string;
  spec?: string | Record<string, unknown>;
  tools?: string | ToolSet;
  auth?: AuthConfig;
  description?: string;
}

// ---- ToolSet Types ----

export interface ToolSet {
  version: number;
  target: string;
  base_url: string;
  auth: AuthConfig;
  endpoints: ToolSetEndpoint[];
}

export interface ToolSetEndpoint {
  name: string;
  description: string;
  method: string;
  path: string;
  params: ParamInfo[];
  has_body: boolean;
  parameters: Record<string, unknown>;
}

// ---- Conversation Types ----

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  enabledSources?: string[];
  disabledTools?: string[];
}

// ---- Engine Types ----

export interface LLMConfig {
  apiBase: string;
  apiKey: string;
  model: string;
  stream?: boolean;
}

export interface EngineConfig {
  llm: LLMConfig;
  targets?: TargetConfig[];
  language?: 'zh' | 'en' | 'ja';
  maxContextTokens?: number;
  storage?: StorageAdapter;
  confirm?: ConfirmFunc;
  proxy?: string;
}

export type ConfirmFunc = (toolName: string, argsJSON: string) => boolean | Promise<boolean>;

// ---- Events ----

export interface EngineEvent {
  type: 'content_delta' | 'content' | 'tool_call' | 'tool_result' | 'usage' | 'error';
  data: unknown;
}

export interface ChatOptions {
  conversationId?: string;
  authToken?: string;
  onEvent?: (event: EngineEvent) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (name: string, args: string) => void;
  onToolResult?: (name: string, result: string) => void;
  onDone?: (conversationId: string) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

// ---- Storage ----

export interface StorageAdapter {
  load(id: string): Conversation | null | Promise<Conversation | null>;
  save(conv: Conversation): void | Promise<void>;
  delete(id: string): void | Promise<void>;
  list(): Conversation[] | Promise<Conversation[]>;
}

// ---- Public Engine Interface ----

export interface NLUIEngine {
  chat(message: string, options?: ChatOptions): Promise<string>;
  createConversation(title?: string): Conversation;
  getConversation(id: string): Conversation | null;
  listConversations(): Conversation[];
  deleteConversation(id: string): void;
  editMessage(convId: string, index: number, content: string): void;
  deleteMessage(convId: string, index: number): void;
  deleteMessagesFrom(convId: string, index: number): void;
  regenerateFrom(convId: string, index: number, options?: ChatOptions): Promise<void>;
  updateToolConfig(convId: string, enabledSources?: string[], disabledTools?: string[]): void;
  tools(): Tool[];
  getConfig(): { llm: LLMConfig; language: string; proxy: string };
  updateLLMConfig(apiBase: string, apiKey: string, model: string): void;
  updateStream(enabled: boolean): void;
  updateLanguage(lang: 'zh' | 'en' | 'ja'): void;
  updateProxy(proxy: string): void;
}
