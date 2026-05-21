import { createMockAdapter } from './mock-adapter.mjs';
import { createShellAdapter } from './shell-adapter.mjs';

const adapterFactories = {
  mock: createMockAdapter,
  shell: createShellAdapter,
};

function availableAgentAdapters() {
  return Object.keys(adapterFactories);
}

function createAgentAdapter(adapterId = 'mock') {
  const factory = adapterFactories[adapterId];
  if (!factory) {
    throw new Error(`未知 Agent Adapter：${adapterId}。可用值：${availableAgentAdapters().join(', ')}`);
  }
  return factory();
}

export { availableAgentAdapters, createAgentAdapter };
