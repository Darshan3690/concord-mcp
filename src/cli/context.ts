import { resolveRepoRoot, workspaceIdForRoot } from '../config/paths.js';
import { openRepositories, type Repositories } from '../db/index.js';
import { localStore, resolveStore, type StoreLocation } from '../workspaces/store.js';

export interface CliContext {
  workspaceId: string;
  repoRoot: string;
  concordPath: string;
  store: StoreLocation;
  repos: Repositories;
}

export interface OpenContextOptions {
  /** Open the repository's own `.concord/` even when global mode would choose otherwise. */
  readonly local?: boolean;
}

/** Resolve the repo root with the same priority as MCP and open that workspace. */
export function openContext(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  options: OpenContextOptions = {},
): CliContext {
  const repoRoot = resolveRepoRoot(cwd, env);
  const store = options.local === true ? localStore(repoRoot) : resolveStore(repoRoot, env);
  return {
    workspaceId: workspaceIdForRoot(repoRoot),
    repoRoot,
    concordPath: store.concordPath,
    store,
    repos: openRepositories(store.databasePath, store.project),
  };
}
