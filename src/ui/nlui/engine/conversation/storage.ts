import type { Conversation, StorageAdapter } from '../types';

/**
 * In-memory storage. Default for Node.js and server-side use.
 */
export class MemoryStorage implements StorageAdapter {
  private store = new Map<string, Conversation>();

  load(id: string): Conversation | null {
    return this.store.get(id) ?? null;
  }

  save(conv: Conversation): void {
    this.store.set(conv.id, conv);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  list(): Conversation[] {
    return [...this.store.values()];
  }
}

/**
 * localStorage-based storage for browser environments.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(prefix = 'nlui_conv_') {
    this.prefix = prefix;
  }

  load(id: string): Conversation | null {
    const raw = localStorage.getItem(this.prefix + id);
    return raw ? JSON.parse(raw) : null;
  }

  save(conv: Conversation): void {
    localStorage.setItem(this.prefix + conv.id, JSON.stringify(conv));
    // Update index
    const index = this.loadIndex();
    if (!index.includes(conv.id)) {
      index.push(conv.id);
      localStorage.setItem(this.prefix + '_index', JSON.stringify(index));
    }
  }

  delete(id: string): void {
    localStorage.removeItem(this.prefix + id);
    const index = this.loadIndex().filter(i => i !== id);
    localStorage.setItem(this.prefix + '_index', JSON.stringify(index));
  }

  list(): Conversation[] {
    const convs: Conversation[] = [];
    for (const id of this.loadIndex()) {
      const conv = this.load(id);
      if (conv) convs.push(conv);
    }
    return convs;
  }

  private loadIndex(): string[] {
    const raw = localStorage.getItem(this.prefix + '_index');
    return raw ? JSON.parse(raw) : [];
  }
}
