import { declaredCapabilities } from './declared';
import { observedHiddenContent } from './hidden';
import { install } from './install';
import { observedNetwork } from './network';
import { observedRemoteExecution } from './shell';
import type { Analyzer } from './types';

/**
 * The entire extension point. A seventh analyzer costs one file and one
 * element here — see src/detect/index.ts for the identical shape, and
 * src/analyze/run.ts for why the list travels as a parameter rather than
 * being imported directly by anything that runs a pass.
 */
export const ANALYZERS: Analyzer[] = [
  install,
  declaredCapabilities,
  observedNetwork,
  observedRemoteExecution,
  observedHiddenContent,
];
