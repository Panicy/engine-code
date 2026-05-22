import { createProcessAgentAdapter } from './process-agent-adapter.mjs';

function createCodexAdapter() {
  return createProcessAgentAdapter({
    id: 'codex',
    tool: 'codex',
    model: 'codex',
    argPrefix: 'codex',
    defaultCommand: 'codex',
    defaultExtraArgs: ['exec'],
    supportsModelArg: true,
    label: 'Codex CLI',
  });
}

export { createCodexAdapter };
