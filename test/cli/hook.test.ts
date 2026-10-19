import { beforeEach, describe, expect, it } from 'vitest';

import {
  decidePreToolUse,
  handleAntigravityPreInvocation,
  handleAntigravitySessionStart,
  handleAntigravityStop,
  handleSessionStart,
  sessionStartIdentity,
} from '../../src/cli/commands/hook.js';
import { openDatabase } from '../../src/db/connection.js';
import { createRepositories, type Repositories } from '../../src/db/index.js';
import { handleClaimWork } from '../../src/tools/claim-work.js';
import { handleRegisterAgent } from '../../src/tools/register-agent.js';
import { handleSendAgentMessage } from '../../src/tools/agent-messages.js';

function preToolUse(filePath: string): string {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
}

describe('decidePreToolUse', () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  it('allows edits to files no other task has claimed', () => {
    handleClaimWork(repos, { task_id: 'T1', title: 'Other', expected_files: ['src/a.ts'] });
    const decision = decidePreToolUse(repos, preToolUse('src/b.ts'), 'MINE');
    expect(decision.block).toBe(false);
    expect(decision.message).toBe('');
  });

  it('blocks an edit to a file claimed by another active task', () => {
    handleClaimWork(repos, { task_id: 'OTHER', title: 'Owns app', expected_files: ['src/app.ts'] });
    const decision = decidePreToolUse(repos, preToolUse('src/app.ts'), 'MINE');
    expect(decision.block).toBe(true);
    expect(decision.message).toContain('OTHER');
  });

  it('does not block your own claimed file when CONCORD_TASK matches', () => {
    handleClaimWork(repos, { task_id: 'MINE', title: 'Mine', expected_files: ['src/app.ts'] });
    expect(decidePreToolUse(repos, preToolUse('src/app.ts'), 'MINE').block).toBe(false);
  });

  it('advises but does not block when the task id is unknown', () => {
    handleClaimWork(repos, { task_id: 'OTHER', title: 'Owns', expected_files: ['src/app.ts'] });
    const decision = decidePreToolUse(repos, preToolUse('src/app.ts'), undefined);
    expect(decision.block).toBe(false);
    expect(decision.message).toContain('CONCORD_TASK');
  });

  it('allows when there is no file path or the payload is malformed', () => {
    handleClaimWork(repos, { task_id: 'OTHER', title: 'Owns', expected_files: ['src/app.ts'] });
    expect(
      decidePreToolUse(repos, JSON.stringify({ tool_name: 'Bash', tool_input: {} }), 'MINE').block,
    ).toBe(false);
    expect(decidePreToolUse(repos, 'not valid json', 'MINE').block).toBe(false);
  });
});

describe('sessionStartIdentity', () => {
  it('derives a stable id from the session id', () => {
    const id = sessionStartIdentity('a1b2c3d4-e5f6-7890', {})?.agentId;

    expect(id).toMatch(/^claude-code:[0-9a-f]{8}$/);
    expect(sessionStartIdentity('a1b2c3d4-e5f6-7890', {})?.agentId).toBe(id);
  });

  it('separates sessions that share a leading timestamp', () => {
    expect(sessionStartIdentity('019fd3d0-aaaa-7211-b743-000000000001', {})?.agentId).not.toBe(
      sessionStartIdentity('019fd3d0-bbbb-7211-b743-000000000002', {})?.agentId,
    );
  });

  it('invents nothing when no session id is given', () => {
    // A random suffix here would produce an agent the relay never registers an
    // endpoint for: addressable, and permanently undeliverable.
    expect(sessionStartIdentity(undefined, {})).toBeUndefined();
  });
});

describe('handleSessionStart', () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  it('registers the session as an agent and reports its id', () => {
    const result = handleSessionStart(
      repos,
      JSON.stringify({ session_id: 'a1b2c3d4-e5f6', cwd: '/repo' }),
    );
    expect(result.agentId).toMatch(/^claude-code:[0-9a-f]{8}$/);
    expect(result.message).toContain(result.agentId);
    expect(result.message).toContain('start_work, update_work, finish_work');
    expect(result.message).not.toContain('claim_work');
    expect(result.message).toContain('No other agents');
    expect(repos.agents.get(result.agentId ?? '')?.cwd).toBe('/repo');
  });

  it('is idempotent for the same session and lists other present agents', () => {
    handleRegisterAgent(repos, {
      agent_id: 'codex:9q2r',
      kind: 'codex',
      summary: 'building the backend',
    });
    const payload = JSON.stringify({ session_id: 'a1b2c3d4' });
    handleSessionStart(repos, payload);
    const again = handleSessionStart(repos, payload);
    expect(repos.agents.list()).toHaveLength(2);
    expect(again.message).toContain('codex:9q2r');
    expect(again.message).toContain('building the backend');
  });

  it('falls back to the environment when the payload is malformed', () => {
    const result = handleSessionStart(repos, 'not json', {
      CLAUDE_CODE_SESSION_ID: 'a1b2c3d4-e5f6-7890',
    });

    expect(result.agentId).toMatch(/^claude-code:[0-9a-f]{8}$/);
  });

  it('registers nothing when a malformed payload has no environment to fall back on', () => {
    // Generating an id here would create an agent the relay never registers an
    // endpoint for: addressable by peers, and permanently undeliverable.
    const result = handleSessionStart(repos, 'not json', {});

    expect(result.agentId).toBeUndefined();
    expect(result.message).toContain('concord inbox register');
    expect(repos.agents.list()).toHaveLength(0);
  });
});

describe('Antigravity hook handlers', () => {
  let repos: Repositories;
  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  describe('handleAntigravitySessionStart', () => {
    it('registers the agent and returns ephemeral message with agent id', () => {
      const payload = JSON.stringify({ conversationId: 'conv-test-123' });
      const result = handleAntigravitySessionStart(repos, payload);

      expect(result.agentId).toMatch(/^antigravity:[0-9a-f]{8}$/);
      expect(repos.agents.get(result.agentId!)).toBeDefined();
      expect(repos.agentEndpoints.getByAgent(result.agentId!)).toBeDefined();

      const output = JSON.parse(result.output);
      expect(output.injectSteps).toHaveLength(1);
      expect(output.injectSteps[0].ephemeralMessage).toContain(result.agentId);
    });

    it('returns error message when conversationId is missing', () => {
      const result = handleAntigravitySessionStart(repos, '{}');
      expect(result.agentId).toBeUndefined();
      const output = JSON.parse(result.output);
      expect(output.injectSteps[0].ephemeralMessage).toContain('Concord cannot tell which session you are');
    });
  });

  describe('handleAntigravityPreInvocation', () => {
    it('returns empty injectSteps when no messages are pending', () => {
      const payload = JSON.stringify({ conversationId: 'conv-test-123' });
      const result = handleAntigravityPreInvocation(repos, payload);
      expect(JSON.parse(result.output)).toEqual({ injectSteps: [] });
    });

    it('drains pending inbox messages and injects them as userMessage', () => {
      const payload = JSON.stringify({ conversationId: 'conv-test-123' });
      const start = handleAntigravitySessionStart(repos, payload);
      const recipientId = start.agentId!;

      handleRegisterAgent(repos, { agent_id: 'claude:sender', kind: 'claude-code' });
      handleSendAgentMessage(repos, {
        operation: 'prompt',
        agentId: 'claude:sender',
        toAgentId: recipientId,
        content: 'Review the latest diff please.',
        idempotencyKey: 'k-1',
      });

      const result = handleAntigravityPreInvocation(repos, payload);
      const parsed = JSON.parse(result.output);
      expect(parsed.injectSteps).toHaveLength(1);
      expect(parsed.injectSteps[0].userMessage).toContain('Review the latest diff please.');
      expect(parsed.injectSteps[0].userMessage).toContain('claude:sender');

      // Subsequent call should have no more pending messages
      const secondResult = handleAntigravityPreInvocation(repos, payload);
      expect(JSON.parse(secondResult.output)).toEqual({ injectSteps: [] });
    });
  });

  describe('handleAntigravityStop', () => {
    it('returns empty object when no messages are pending at stop', () => {
      const payload = JSON.stringify({ conversationId: 'conv-test-123' });
      const result = handleAntigravityStop(repos, payload);
      expect(JSON.parse(result.output)).toEqual({});
    });

    it('continues turn with reason when new messages arrived before stop', () => {
      const payload = JSON.stringify({ conversationId: 'conv-test-123' });
      const start = handleAntigravitySessionStart(repos, payload);
      const recipientId = start.agentId!;

      handleRegisterAgent(repos, { agent_id: 'claude:sender', kind: 'claude-code' });
      handleSendAgentMessage(repos, {
        operation: 'prompt',
        agentId: 'claude:sender',
        toAgentId: recipientId,
        content: 'Wait, one more thing!',
        idempotencyKey: 'k-2',
      });

      const result = handleAntigravityStop(repos, payload);
      const parsed = JSON.parse(result.output);
      expect(parsed.decision).toBe('continue');
      expect(parsed.reason).toContain('Wait, one more thing!');
    });
  });
});

