import { beforeEach, describe, expect, it } from 'vitest';

// Minimal browser stubs so the store can run under vitest without a DOM.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window ??= { dispatchEvent: () => true };
(globalThis as any).window.dispatchEvent ??= () => true;

const { deleteChat, getChat, getCurrentChatId, listChats, saveChat, setCurrentChatId, titleFor } = await import('./chats');

describe('saved chats', () => {
  beforeEach(() => store.clear());

  it('saves, lists newest first, and reopens a chat', () => {
    saveChat('a', [{ q: 'How do I stop bleeding?', a: 'Press hard.', sources: [] }]);
    saveChat('b', [{ q: 'Make water safe', a: 'Boil it.', sources: [] }]);
    expect(listChats().map((c) => c.id)).toEqual(['b', 'a']);
    expect(getChat('a')?.turns[0].a).toBe('Press hard.');
    expect(getChat('a')?.title).toBe('How do I stop bleeding?');
  });

  it('updates an existing chat instead of duplicating it', () => {
    saveChat('a', [{ q: 'one', a: '1', sources: [] }]);
    saveChat('a', [{ q: 'one', a: '1', sources: [] }, { q: 'two', a: '2', sources: [] }]);
    expect(listChats()).toHaveLength(1);
    expect(getChat('a')?.turns).toHaveLength(2);
  });

  it('ignores empty chats and deletes cleanly, including the current one', () => {
    saveChat('empty', []);
    expect(listChats()).toHaveLength(0);
    saveChat('a', [{ q: 'q', a: 'a', sources: [] }]);
    setCurrentChatId('a');
    deleteChat('a');
    expect(listChats()).toHaveLength(0);
    expect(getCurrentChatId()).toBeNull();
  });

  it('shortens long titles and survives corrupted storage', () => {
    expect(titleFor([{ q: 'x'.repeat(100), a: '', sources: [] }])).toHaveLength(58);
    store.set('cai.chats.v1', '{not json');
    expect(listChats()).toEqual([]);
  });
});
