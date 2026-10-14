import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HarnessName } from '../../domain/harness-config.js';
import { userHome } from '../../config/paths.js';
import { claudeSkillsPluginPath } from '../claude-plugin.js';

/** Harnesses whose adapter is a link to a directory shipped in this package. */
const LINKED_ADAPTERS = {
  'claude-code': ['plugin', 'concord-relay'],
  gemini: ['plugin', 'gemini', 'concord-relay'],
  cursor: ['plugin', 'cursor', 'concord-relay'],
} as const satisfies Partial<Record<HarnessName, readonly string[]>>;

export type LinkedHarness = keyof typeof LINKED_ADAPTERS;

export function geminiTarget(env: NodeJS.ProcessEnv): string {
  return join(userHome(env), '.gemini', 'extensions', 'concord-relay');
}

export function cursorTarget(env: NodeJS.ProcessEnv): string {
  return join(userHome(env), '.cursor', 'extensions', 'get-concord-ai.concord-relay');
}

export function linkTarget(harness: LinkedHarness, env: NodeJS.ProcessEnv): string {
  if (harness === 'claude-code') return claudeSkillsPluginPath(env);
  return harness === 'gemini' ? geminiTarget(env) : cursorTarget(env);
}

/** The directory this package ships for a harness, found by walking up from the caller. */
export function packagedAdapter(moduleUrl: string, harness: LinkedHarness): string | undefined {
  return packagedPath(moduleUrl, LINKED_ADAPTERS[harness]);
}

/**
 * Walks up from the calling module rather than counting `..` segments, because
 * the caller sits at a different depth in `src/` than in `dist/`.
 */
export function packagedPath(moduleUrl: string, parts: readonly string[]): string | undefined {
  let directory = dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 7; depth += 1) {
    const candidate = join(directory, ...parts);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function hasConcordManifest(path: string): boolean {
  const manifests = [
    join(path, '.claude-plugin', 'plugin.json'),
    join(path, 'gemini-extension.json'),
    join(path, 'package.json'),
  ];
  return manifests.some((manifest) => {
    try {
      return readFileSync(manifest, 'utf8').includes('concord-relay');
    } catch {
      return false;
    }
  });
}

/** Link `source` at `target`, replacing an older Concord link but never a real directory. */
export function installLink(source: string, target: string): 'installed' | 'occupied' {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) || isSymlink(target)) {
    if (!isSymlink(target)) return 'occupied';
    if (readlinkSync(target) === source) return 'installed';
    rmSync(target);
  }
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  return 'installed';
}
