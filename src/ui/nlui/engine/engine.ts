import type {
  EngineConfig, NLUIEngine, Tool, Conversation, ChatOptions, EngineEvent, ToolSet, LLMConfig,
} from './types';
import { newAutoClient } from './llm/client';
import { ToolLoop } from './toolloop/loop';
import { GatewayCaller } from './gateway/caller';
import { buildTools } from './gateway/builder';
import { buildFromToolSet, parseToolSet } from './gateway/toolset';
import { loadSpec } from './gateway/openapi';
import { ConversationManager } from './conversation/manager';
import { MemoryStorage } from './conversation/storage';
import { buildSystemPrompt } from './prompt';
import type { Endpoint } from './types';

/**
 * Create an NLUIEngine instance.
 *
 * Loads all target specs, builds tools, constructs system prompt,
 * and wires up the LLM client + tool loop + conversation manager.
 */
export async function createEngine(config: EngineConfig): Promise<NLUIEngine> {
  // Mutable config state for runtime hot-reload
  let currentLLM: LLMConfig = { ...config.llm };
  let currentLang: 'zh' | 'en' | 'ja' = config.language ?? 'en';
  let currentProxy = config.proxy ?? '';

  let llmClient = newAutoClient(currentLLM);

  // Discover tools from all targets
  const allTools: Tool[] = [];
  const allEndpoints = new Map<string, Endpoint>();
  const targets = config.targets ?? [];

  for (const target of targets) {
    try {
      let tools: Tool[];
      let endpoints: Map<string, Endpoint>;

      if (target.tools) {
        const ts: ToolSet = typeof target.tools === 'string'
          ? parseToolSet(target.tools)
          : target.tools;
        ({ tools, endpoints } = buildFromToolSet(ts));
      } else if (target.spec) {
        const doc = await loadSpec(target.spec);
        const auth = target.auth ?? { type: '' };
        const baseURL = target.baseURL ?? '';
        ({ tools, endpoints } = buildTools(doc, target.name, baseURL, auth));
      } else {
        continue;
      }

      allTools.push(...tools);
      for (const [k, v] of endpoints) allEndpoints.set(k, v);
    } catch (err) {
      console.warn(`Skip target ${target.name}:`, err);
    }
  }

  // Build system prompt
  let systemPrompt = buildSystemPrompt(currentLang, targets, allTools);

  // Setup executor
  const caller = new GatewayCaller(allEndpoints);

  // Setup tool loop
  let loop = new ToolLoop(llmClient, caller);
  if (config.maxContextTokens) loop.setMaxContextTokens(config.maxContextTokens);
  if (config.confirm) loop.setConfirm(config.confirm);

  function rebuildLoop() {
    llmClient = newAutoClient(currentLLM);
    loop = new ToolLoop(llmClient, caller);
    if (config.maxContextTokens) loop.setMaxContextTokens(config.maxContextTokens);
    if (config.confirm) loop.setConfirm(config.confirm);
  }

  // Setup conversation manager
  const storage = config.storage ?? new MemoryStorage();
  const convMgr = new ConversationManager(storage);
  await convMgr.init();

  // Build the engine object
  const engine: NLUIEngine = {
    async chat(message: string, options?: ChatOptions): Promise<string> {
      const onEvent = buildEventRouter(options);

      let conv = options?.conversationId ? convMgr.get(options.conversationId) : null;
      const isNew = !conv;
      if (isNew) conv = convMgr.create('', systemPrompt);
      const convId = conv!.id;

      conv!.messages.push({ role: 'user', content: message });

      if (isNew) {
        const title = message.length > 30 ? message.slice(0, 30) + '...' : message;
        convMgr.updateTitle(convId, title);
      }

      const enabledTools = filterTools(allTools, conv!);

      try {
        const finalMessages = await loop.run(
          conv!.messages, enabledTools,
          options?.authToken ?? '',
          onEvent,
          options?.signal,
        );
        convMgr.updateMessages(convId, finalMessages);
        options?.onDone?.(convId);
      } catch (err) {
        options?.onError?.(err instanceof Error ? err : new Error(String(err)));
        // Still save whatever messages we have
        convMgr.updateMessages(convId, conv!.messages);
      }

      return convId;
    },

    createConversation(title?: string): Conversation {
      return convMgr.create(title ?? '', systemPrompt);
    },

    getConversation(id: string): Conversation | null {
      return convMgr.get(id);
    },

    listConversations(): Conversation[] {
      return convMgr.list();
    },

    deleteConversation(id: string): void {
      convMgr.delete(id);
    },

    editMessage(convId: string, index: number, content: string): void {
      convMgr.editMessage(convId, index, content);
    },

    deleteMessage(convId: string, index: number): void {
      convMgr.deleteMessage(convId, index);
    },

    deleteMessagesFrom(convId: string, index: number): void {
      convMgr.deleteMessagesFrom(convId, index);
    },

    async regenerateFrom(convId: string, index: number, options?: ChatOptions): Promise<void> {
      convMgr.deleteMessagesFrom(convId, index);
      const conv = convMgr.get(convId);
      if (!conv) throw new Error('Conversation not found');

      const enabledTools = filterTools(allTools, conv);
      const onEvent = buildEventRouter(options);

      const finalMessages = await loop.run(
        conv.messages, enabledTools,
        options?.authToken ?? '',
        onEvent,
        options?.signal,
      );
      convMgr.updateMessages(convId, finalMessages);
    },

    updateToolConfig(convId: string, enabledSources?: string[], disabledTools?: string[]): void {
      convMgr.updateToolConfig(convId, enabledSources, disabledTools);
    },

    tools(): Tool[] {
      return allTools;
    },

    getConfig() {
      return { llm: { ...currentLLM }, language: currentLang, proxy: currentProxy };
    },

    updateLLMConfig(apiBase: string, apiKey: string, model: string) {
      currentLLM = { ...currentLLM, apiBase, apiKey, model };
      rebuildLoop();
    },

    updateStream(enabled: boolean) {
      currentLLM = { ...currentLLM, stream: enabled };
      rebuildLoop();
    },

    updateLanguage(lang: 'zh' | 'en' | 'ja') {
      currentLang = lang;
      systemPrompt = buildSystemPrompt(lang, targets, allTools);
    },

    updateProxy(proxy: string) {
      currentProxy = proxy;
    },
  };

  return engine;
}

// ---- Internal helpers ----

function buildEventRouter(options?: ChatOptions): (event: EngineEvent) => void {
  return (event: EngineEvent) => {
    options?.onEvent?.(event);
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'content_delta':
        options?.onDelta?.(data.delta as string);
        break;
      case 'tool_call':
        options?.onToolCall?.(data.name as string, data.arguments as string);
        break;
      case 'tool_result':
        options?.onToolResult?.(data.name as string, data.result as string);
        break;
    }
  };
}

function extractSource(toolName: string): string {
  const idx = toolName.indexOf('__');
  return idx > 0 ? toolName.slice(0, idx) : 'default';
}

function filterTools(tools: Tool[], conv: Conversation): Tool[] {
  if (!conv.enabledSources?.length && !conv.disabledTools?.length) return tools;

  return tools.filter(tool => {
    const name = tool.function.name;
    const source = extractSource(name);

    if (conv.enabledSources?.length && !conv.enabledSources.includes(source)) return false;
    if (conv.disabledTools?.includes(name)) return false;
    return true;
  });
}
