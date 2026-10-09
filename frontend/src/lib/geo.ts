// GPS, saved places (waypoints), distance and direction.

import { useEffect, useState } from 'react';

export interface Place {
  id: string;
  name: string;
  kind: 'home' | 'evac' | 'water' | 'medical' | 'meet' | 'other';
  lat: number;
  lon: number;
}

export const PLACE_KINDS: Record<Place['kind'], { label: string; icon: string; color: string }> = {
  home: { label: 'Home', icon: '🏠', color: '#7ddc8a' },
  evac: { label: 'Evacuation center', icon: '🏫', color: '#f2b84b' },
  water: { label: 'Water source', icon: '💧', color: '#5bb8ef' },
  medical: { label: 'Clinic / hospital', icon: '🏥', color: '#ef6b5b' },
  meet: { label: 'Family meeting point', icon: '👪', color: '#c48bef' },
  other: { label: 'Other', icon: '📍', color: '#d0d0d0' },
};

const LS_PLACES = 'cai.places';
const LS_TARGET = 'cai.target';

export function loadPlaces(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(LS_PLACES) || '[]');
  } catch {
    return [];
  }
}
export function savePlaces(p: Place[]) {
  localStorage.setItem(LS_PLACES, JSON.stringify(p));
  window.dispatchEvent(new Event('cai-places'));
}
export const getTargetId = () => localStorage.getItem(LS_TARGET);
export function setTargetId(id: string | null) {
  if (id) localStorage.setItem(LS_TARGET, id);
  else localStorage.removeItem(LS_TARGET);
  window.dispatchEvent(new Event('cai-places'));
}

export function usePlaces(): [Place[], string | null] {
  const [state, setState] = useState(() => [loadPlaces(), getTargetId()] as [Place[], string | null]);
  useEffect(() => {
    const on = () => setState([loadPlaces(), getTargetId()]);
    window.addEventListener('cai-places', on);
    return () => window.removeEventListener('cai-places', on);
  }, []);
  return state;
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  /** direction of travel in degrees (only while moving); lets the compass work without a magnetometer */
  heading?: number | null;
  speed?: number | null;
  time: number;
}

/** Live GPS position (works offline; GPS does not need internet). */
export function useGps(enabled = true): { fix: Fix | null; error: string | null } {
  const [fix, setFix] = useState<Fix | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('cai.lastfix') || 'null');
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, time: p.timestamp, heading: p.coords.heading, speed: p.coords.speed };
        setFix(f);
        setError(null);
        localStorage.setItem('cai.lastfix', JSON.stringify(f));
      },
      (e) => setError(e.code === 1 ? 'Location permission denied.' : 'Waiting for GPS… go outside for a better signal.'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, error };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Distance in meters (haversine). */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, 0 = north, 90 = east. */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const cardinal = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export function fmtDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
