import { catalog } from './catalog';
import { command } from './command';
import { hook } from './hook';
import { mcp } from './mcp';
import { plugin } from './plugin';
import { skill } from './skill';
import type { Detector } from './types';

/**
 * The entire extension point. A seventh detector costs one file and one
 * element here — see src/detect/run.test.ts for the runtime proof.
 */
export const DETECTORS: Detector[] = [skill, catalog, plugin, mcp, command, hook];
