import { homedir } from 'node:os';
import { join } from 'node:path';

/** Directory name the plugin is discovered under, and its invocation name. */
export const RELAY_PLUGIN_NAME = 'concord-relay';

/**
 * Where Claude Code discovers plugins with no marketplace and no install step:
 * any directory under the skills directory holding a `.claude-plugin/`
 * manifest loads on the next session.
 */
export function claudeSkillsPluginPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), 'skills', RELAY_PLUGIN_NAME);
}

/** Claude Code's user directory: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env['CLAUDE_CONFIG_DIR'];
  return configDir !== undefined && configDir.trim() !== ''
    ? configDir
    : join(env['HOME'] ?? homedir(), '.claude');
}
