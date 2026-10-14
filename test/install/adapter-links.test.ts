import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { claudeSkillsPluginPath } from '../../src/install/claude-plugin.js';
import { installLink, packagedPath } from '../../src/install/adapters/links.js';

/** A stand-in package layout: <root>/plugin/concord-relay + a caller module. */
function packagedTree(): { root: string; moduleUrl: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), 'concord-pkg-'));
  const source = join(root, 'plugin', 'concord-relay');
  mkdirSync(join(source, '.claude-plugin'), { recursive: true });
  writeFileSync(join(source, '.claude-plugin', 'plugin.json'), '{"name":"concord-relay"}');
  return {
    root,
    moduleUrl: pathToFileURL(join(root, 'dist', 'cli', 'commands', 'doctor.js')).href,
    source,
  };
}

describe('adapter links', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let target: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'concord-home-'));
    // An empty PATH: no harness is detected, so only the links decide health.
    env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), PATH: join(home, 'bin') };
    target = claudeSkillsPluginPath(env);
  });

  it('links a source, is a no-op when repeated, and re-points a dangling link', () => {
    const { source } = packagedTree();
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    symlinkSync(join(home, 'gone'), target);

    expect(installLink(source, target)).toBe('installed');
    expect(installLink(source, target)).toBe('installed');
    expect(readlinkSync(target)).toBe(source);
  });

  it('leaves a real directory someone put there alone', () => {
    const { source } = packagedTree();
    mkdirSync(join(target, '.claude-plugin'), { recursive: true });
    writeFileSync(join(target, '.claude-plugin', 'plugin.json'), '{"name":"mine"}');

    expect(installLink(source, target)).toBe('occupied');
    expect(readFileSync(join(target, '.claude-plugin', 'plugin.json'), 'utf8')).toContain('mine');
  });

  it('finds a packaged directory from any caller depth', () => {
    const { root, source } = packagedTree();
    for (const rel of ['dist/cli/setup.js', 'dist/cli/commands/setup.js', 'src/x/y/z/a.ts']) {
      const url = pathToFileURL(join(root, rel)).href;
      expect(packagedPath(url, ['plugin', 'concord-relay'])).toBe(source);
    }
  });

  it('reports nothing when the package has no such directory', () => {
    const bare = mkdtempSync(join(tmpdir(), 'concord-bare-'));
    const url = pathToFileURL(join(bare, 'dist', 'cli', 'setup.js')).href;
    expect(packagedPath(url, ['plugin', 'concord-relay'])).toBeUndefined();
  });
});
