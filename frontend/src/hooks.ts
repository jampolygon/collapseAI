import { useEffect, useState } from 'react';
import { subscribeDownloads, type DLItem } from './lib/downloads';
import { detectDevice, type DeviceInfo } from './lib/device';

export function useDownloads(): DLItem[] {
  const [items, setItems] = useState<DLItem[]>([]);
  useEffect(() => subscribeDownloads(setItems), []);
  return items;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useDevice(): DeviceInfo | null {
  const [d, setD] = useState<DeviceInfo | null>(null);
  useEffect(() => {
    detectDevice().then(setD);
  }, []);
  return d;
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}
