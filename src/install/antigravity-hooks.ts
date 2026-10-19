import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { userHome } from '../config/paths.js';

export const ANTIGRAVITY_HOOKS = {
  SessionStart: [
    {
      command: 'concord hook session-start --client antigravity',
    },
  ],
  PreInvocation: [
    {
      command: 'concord hook pre-invocation --client antigravity',
      timeout: 5,
    },
  ],
  Stop: [
    {
      command: 'concord hook stop --client antigravity',
      timeout: 5,
    },
  ],
} as const;

export const ANTIGRAVITY_HOOK_KEY = 'concord';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Idempotently add or update Concord's lifecycle hooks in an Antigravity hooks.json.
 * Any other named hook entries are preserved.
 */
export function upsertAntigravityHooks(existing: string | undefined): string {
  let parsed: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== '') {
    try {
      const data: unknown = JSON.parse(existing);
      if (isRecord(data)) parsed = { ...data };
    } catch {
      // Malformed json replaced with clean object containing our hooks.
    }
  }

  const updated = {
    ...parsed,
    [ANTIGRAVITY_HOOK_KEY]: ANTIGRAVITY_HOOKS,
  };

  return `${JSON.stringify(updated, null, 2)}\n`;
}

/**
 * Remove Concord's hooks from an Antigravity hooks.json string, preserving any other hooks.
 */
export function removeAntigravityHooks(existing: string): string {
  if (existing.trim() === '') return '{}\n';
  try {
    const data: unknown = JSON.parse(existing);
    if (!isRecord(data)) return '{}\n';
    const remaining = Object.fromEntries(
      Object.entries(data).filter(([key]) => key !== ANTIGRAVITY_HOOK_KEY),
    );
    return `${JSON.stringify(remaining, null, 2)}\n`;
  } catch {
    return existing;
  }
}

/**
 * Whether an Antigravity hooks.json registers Concord's hooks.
 */
export function hasAntigravityHooks(existing: string): boolean {
  try {
    if (existing.trim() === '') return false;
    const data: unknown = JSON.parse(existing);
    if (!isRecord(data)) return false;
    const concord = data[ANTIGRAVITY_HOOK_KEY];
    if (!isRecord(concord)) return false;
    return (
      Array.isArray(concord['PreInvocation']) &&
      Array.isArray(concord['SessionStart'])
    );
  } catch {
    return false;
  }
}

/**
 * Write Concord's lifecycle hooks into `.agents/hooks.json` under repoRoot.
 */
export function installAntigravityHooks(repoRoot: string): string {
  const relPath = join('.agents', 'hooks.json');
  const fullPath = join(repoRoot, relPath);
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined;
  const updated = upsertAntigravityHooks(existing);

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, updated);
  return relPath;
}

/**
 * Path to global Antigravity hooks.json (~/.gemini/config/hooks.json).
 */
export function globalAntigravityHooksPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(userHome(env), '.gemini', 'config', 'hooks.json');
}

/**
 * Install Concord hooks in the global Antigravity config directory.
 */
export function installGlobalAntigravityHooks(env: NodeJS.ProcessEnv = process.env): string {
  const path = globalAntigravityHooksPath(env);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const updated = upsertAntigravityHooks(existing);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, updated, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(path, 0o600);
  return path;
}

/**
 * Remove Concord hooks from the global Antigravity config directory.
 */
export function uninstallGlobalAntigravityHooks(env: NodeJS.ProcessEnv = process.env): void {
  const path = globalAntigravityHooksPath(env);
  if (!existsSync(path)) return;
  const existing = readFileSync(path, 'utf8');
  const updated = removeAntigravityHooks(existing);
  const trimmed = updated.trim();
  if (trimmed === '{}' || trimmed === '') {
    rmSync(path);
  } else {
    writeFileSync(path, updated, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  }
}
