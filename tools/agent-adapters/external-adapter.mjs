import { createProcessAgentAdapter } from './process-agent-adapter.mjs';

function createExternalAdapter() {
  return createProcessAgentAdapter({
    id: 'external',
    tool: 'external-agent',
    model: 'external',
    argPrefix: 'external-agent',
    defaultCommand: '',
    defaultExtraArgs: [],
    supportsModelArg: false,
    label: 'external agent',
  });
}

export { createExternalAdapter };
