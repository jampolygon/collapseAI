import type { EmergencyPoi } from './mapTypes';

// Keep this list empty until locations can be sourced and independently verified.
export const EMERGENCY_POIS: EmergencyPoi[] = [];

export const EMERGENCY_POI_DATASET = {
  version: 1,
  updatedAt: null,
  source: null,
  points: EMERGENCY_POIS,
} as const;
