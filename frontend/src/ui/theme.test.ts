import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../components/ThemeToggle';
import { useTheme, type Theme } from './theme';

// Exercise the button handler with the real persistence hook. React state/effects
// are simulated here; keyboard activation and layout still need a browser check.
const hooks = vi.hoisted(() => ({ value: undefined as Theme | undefined, setState: vi.fn() }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: () => Theme) => {
    hooks.value ??= initial();
    return [hooks.value, (value: Theme) => { hooks.value = value; hooks.setState(value); }];
  },
  useEffect: (effect: () => void) => effect(),
}));

let stored: Map<string, string>;
beforeEach(() => {
  hooks.value = undefined;
  hooks.setState.mockClear();
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('document', {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => ({ setAttribute: vi.fn() }),
  });
});
afterEach(() => vi.unstubAllGlobals());

const renderToggle = () => {
  const [theme, onChange] = useTheme();
  return ThemeToggle({ theme, onChange });
};

describe('one-click theme toggle', () => {
  it.each([
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const)('switches %s to %s with one click and persists across reload', (initial, next) => {
    stored.set('cai.theme', initial);
    const button = renderToggle();
    expect(button.type).toBe('button');
    expect(button.props.type).toBe('button');
    expect(button.props['aria-label']).toBe(`Switch to ${next} theme`);

    button.props.onClick();
    expect(hooks.setState).toHaveBeenCalledExactlyOnceWith(next);
    expect(stored.get('cai.theme')).toBe(next);
    expect(renderToggle().props['aria-label']).toBe(`Switch to ${initial} theme`);
    expect(document.documentElement.dataset.theme).toBe(next);
    expect(document.documentElement.style.colorScheme).toBe(next);

    hooks.value = undefined; // A fresh mount reads the saved preference.
    expect(renderToggle().props['aria-label']).toBe(`Switch to ${initial} theme`);
  });

  it('defaults to light and still toggles when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked'); },
      setItem: () => { throw new Error('Storage blocked'); },
    });
    const button = renderToggle();
    expect(button.props['aria-label']).toBe('Switch to dark theme');
    expect(() => button.props.onClick()).not.toThrow();
    expect(hooks.setState).toHaveBeenCalledExactlyOnceWith('dark');
    expect(renderToggle().props['aria-label']).toBe('Switch to light theme');
  });
});
