import type { Conversation, Message, StorageAdapter } from '../types';

function newID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export class ConversationManager {
  private storage: StorageAdapter;
  private cache = new Map<string, Conversation>();

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async init(): Promise<void> {
    const convs = await this.storage.list();
    for (const c of convs) this.cache.set(c.id, c);
  }

  create(title: string, systemPrompt: string): Conversation {
    const now = Date.now();
    const messages: Message[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

    // Inherit tool config from most recent conversation
    let latest: Conversation | null = null;
    for (const c of this.cache.values()) {
      if (!latest || c.updatedAt > latest.updatedAt) latest = c;
    }

    const conv: Conversation = {
      id: newID(),
      title,
      messages,
      createdAt: now,
      updatedAt: now,
      enabledSources: latest?.enabledSources ? [...latest.enabledSources] : undefined,
      disabledTools: latest?.disabledTools ? [...latest.disabledTools] : undefined,
    };

    this.cache.set(conv.id, conv);
    this.storage.save(conv);
    return conv;
  }

  get(id: string): Conversation | null {
    return this.cache.get(id) ?? null;
  }

  list(): Conversation[] {
    return [...this.cache.values()];
  }

  updateTitle(id: string, title: string): void {
    const conv = this.cache.get(id);
    if (!conv) return;
    conv.title = title;
    this.storage.save(conv);
  }

  updateMessages(id: string, messages: Message[]): void {
    const conv = this.cache.get(id);
    if (!conv) return;
    conv.messages = messages;
    conv.updatedAt = Date.now();
    this.storage.save(conv);
  }

  delete(id: string): void {
    this.cache.delete(id);
    this.storage.delete(id);
  }

  editMessage(id: string, index: number, content: string): void {
    const conv = this.cache.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (index < 0 || index >= conv.messages.length) throw new Error('Invalid message index');
    conv.messages[index].content = content;
    conv.messages = conv.messages.slice(0, index + 1);
    conv.updatedAt = Date.now();
    this.storage.save(conv);
  }

  deleteMessage(id: string, index: number): void {
    const conv = this.cache.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (index < 0 || index >= conv.messages.length) throw new Error('Invalid message index');
    conv.messages.splice(index, 1);
    conv.updatedAt = Date.now();
    this.storage.save(conv);
  }

  deleteMessagesFrom(id: string, index: number): void {
    const conv = this.cache.get(id);
    if (!conv) throw new Error('Conversation not found');
    if (index < 0 || index >= conv.messages.length) throw new Error('Invalid message index');
    conv.messages = conv.messages.slice(0, index);
    conv.updatedAt = Date.now();
    this.storage.save(conv);
  }

  updateToolConfig(id: string, enabledSources?: string[], disabledTools?: string[]): void {
    const conv = this.cache.get(id);
    if (!conv) throw new Error('Conversation not found');
    conv.enabledSources = enabledSources;
    conv.disabledTools = disabledTools;
    conv.updatedAt = Date.now();
    this.storage.save(conv);
  }
}
