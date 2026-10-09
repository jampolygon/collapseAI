import type { SVGProps } from 'react';

// One small, consistent outline family. No remote assets or runtime dependency.
const paths = {
  ask: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  book: 'M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z',
  tools: 'm14 6-8 8a3 3 0 1 0 4 4l8-8M14 6a5 5 0 0 1 7-4l-3 3 1 2 2 1 3-3a5 5 0 0 1-6 7',
  panel: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 0v18m8-13-3 4 3 4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14A8 8 0 0 1 10 4 9 9 0 1 0 20 14Z',
  monitor: 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 14v4m-4 0h8',
  cpu: 'M7 7h10v10H7ZM9 1v6m6-6v6M9 17v6m6-6v6M1 9h6m-6 6h6m10-6h6m-6 6h6M10 10h4v4h-4Z',
  arrow: 'M4 12h16m-5-5 5 5-5 5',
  back: 'M20 12H4m5-5-5 5 5 5',
  send: 'M12 19V5m-6 6 6-6 6 6',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  check: 'm5 12 4 4L19 6',
  info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6',
  signal: 'M4 20v-3m5 3v-7m5 7V9m5 11V4',
  water: 'M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Zm-4 13c0 2 1 3 3 3',
  bag: 'M8 7V5a4 4 0 0 1 8 0v2M6 7h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm2 7h8v5H8Zm0-3h8',
  aid: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
  mountain: 'm2 20 8-16 5 9 3-5 6 12H2Zm5-10 3 3 3-3',
  storm: 'M4 13a4 4 0 0 1 0-8 6 6 0 0 1 11-1 5 5 0 0 1 5 9h-3m-6-3-4 7h5l-3 6',
  food: 'M12 21V10m0 4C4 14 3 8 3 4c6 0 9 3 9 10Zm0-4c0-5 4-8 9-8 0 5-3 8-9 8Z',
  flashlight: 'M7 2h10v5l-3 4v10h-4V11L7 7V2Zm0 5h10m-7 8h4',
  pause: 'M8 4v16M16 4v16',
  play: 'm7 3 14 9-14 9V3Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  file: 'M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8m-8 4h8',
  compass: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-7-3-2 4-4 2 2-4 4-2Z',
};
export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}

export const packIcon = (id: string): IconName => ({ 'first-aid': 'aid', survival: 'mountain', disasters: 'storm', medicine: 'shield', food: 'food', engineering: 'tools' } as Record<string, IconName>)[id] ?? 'book';

// Display-only cleanup; persisted download labels and checklist keys stay intact.
export const plainLabel = (text: string) => text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
