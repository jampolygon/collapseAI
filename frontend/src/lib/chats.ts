// Saved conversations (like chat history in ChatGPT / Claude), stored only on this device.

import type { Passage } from './knowledge';
import type { ChatStats } from './llm';

export interface SavedTurn {
  q: string;
  a: string;
  sources: Passage[];
  stats?: ChatStats | null;
  kind?: 'answer' | 'smalltalk' | 'no-info' | 'general';
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  updated: number;
  turns: SavedTurn[];
}

const LS_CHATS = 'cai.chats.v1';
const LS_CURRENT = 'cai.chats.current';
const MAX_CHATS = 50; // oldest are dropped; keeps localStorage well under its ~5 MB limit

export function listChats(): Chat[] {
  try {
    const chats = JSON.parse(localStorage.getItem(LS_CHATS) || '[]') as Chat[];
    return Array.isArray(chats) ? chats.sort((a, b) => b.updated - a.updated) : [];
  } catch {
    return [];
  }
}

function write(chats: Chat[]) {
  const kept = chats.sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
  try {
    localStorage.setItem(LS_CHATS, JSON.stringify(kept));
  } catch {
    // storage full: drop the oldest half and try once more
    try {
      localStorage.setItem(LS_CHATS, JSON.stringify(kept.slice(0, Math.ceil(kept.length / 2))));
    } catch {
      /* give up silently; the current conversation still works in memory */
    }
  }
  window.dispatchEvent(new Event('cai-chats'));
}

export const titleFor = (turns: SavedTurn[]) => {
  const first = turns.find((t) => t.q.trim())?.q.trim() ?? 'New chat';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
};

export function saveChat(id: string, turns: SavedTurn[]) {
  if (!turns.length) return;
  const chats = listChats().filter((c) => c.id !== id);
  write([{ id, title: titleFor(turns), updated: Date.now(), turns }, ...chats]);
}

export function getChat(id: string | null): Chat | null {
  return id ? listChats().find((c) => c.id === id) ?? null : null;
}

export function deleteChat(id: string) {
  write(listChats().filter((c) => c.id !== id));
  if (getCurrentChatId() === id) setCurrentChatId(null);
}

export function clearChats() {
  write([]);
  setCurrentChatId(null);
}

export const newChatId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function getCurrentChatId(): string | null {
  try {
    return localStorage.getItem(LS_CURRENT);
  } catch {
    return null;
  }
}

export function setCurrentChatId(id: string | null) {
  try {
    if (id) localStorage.setItem(LS_CURRENT, id);
    else localStorage.removeItem(LS_CURRENT);
  } catch {
    /* ignore */
  }
}
