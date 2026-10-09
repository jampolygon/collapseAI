// "Install the app" (PWA): adds CollapseAI to the home screen so it opens like a normal app,
// full screen and offline. Chrome/Edge/Brave on Android & desktop fire `beforeinstallprompt`;
// iPhone and some browsers don't, so we show manual steps there instead.

import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const LS_DISMISSED = 'cai.install.dismissed';
let deferred: InstallEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Must be registered before React mounts: the browser fires this once, early.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own prompt instead of the browser's mini-bar
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installedNow = true;
    deferred = null;
    notify();
  });
}

export const isInstalled = () =>
  installedNow ||
  (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

function readDismissed() {
  try {
    return localStorage.getItem(LS_DISMISSED) === '1';
  } catch {
    return false;
  }
}

export interface InstallState {
  /** already running as an installed app */
  installed: boolean;
  /** the browser offers a one-tap install */
  canPrompt: boolean;
  /** installing is possible at all (secure page, not installed) */
  available: boolean;
  /** the user said "Not now" or refused the browser dialog */
  dismissed: boolean;
  ios: boolean;
  install(): Promise<'accepted' | 'dismissed' | 'manual'>;
  dismiss(): void;
}

export function useInstall(): InstallState {
  const [, force] = useState(0);
  const [dismissed, setDismissed] = useState(readDismissed);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(LS_DISMISSED, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const installed = isInstalled();
  return {
    installed,
    canPrompt: !!deferred,
    available: !installed && typeof window !== 'undefined' && window.isSecureContext,
    dismissed,
    ios: isIos(),
    dismiss,
    async install() {
      if (!deferred) return 'manual';
      const e = deferred;
      deferred = null; // a prompt can only be used once
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'dismissed') dismiss();
      notify();
      return outcome;
    },
  };
}
