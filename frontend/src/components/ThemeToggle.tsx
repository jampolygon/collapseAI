import type { Theme } from '../ui/theme';
import { Icon } from './Icon';

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="theme-control"
      aria-label={`Switch to ${next} theme`}
      onClick={() => onChange(next)}
    >
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />
      <span className="theme-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
