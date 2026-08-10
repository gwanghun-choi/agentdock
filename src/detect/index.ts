import { skill } from './skill';
import type { Detector } from './types';

/**
 * The entire extension point. Phase 3 adds plugin, catalog, mcp, command and
 * hook by writing one file each and appending one element here.
 */
export const DETECTORS: Detector[] = [skill];
