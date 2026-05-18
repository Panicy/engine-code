function decideMockOutcome(task, args) {
  if (args['mock-fail-task'] !== task.id) {
    return {
      requestedStatus: 'done',
      taskRunStatus: 'passed',
      reviewVerdict: 'pass',
      source: 'executor',
    };
  }
  const stage = args['mock-fail-stage'] ?? 'check';
  if (stage === 'check') {
    return {
      requestedStatus: 'checks_failed',
      taskRunStatus: 'checks_failed',
      reviewVerdict: null,
      source: 'check',
    };
  }
  if (stage === 'review') {
    return {
      requestedStatus: 'review_failed',
      taskRunStatus: 'review_failed',
      reviewVerdict: 'fail',
      source: 'reviewer',
    };
  }
  return {
    requestedStatus: 'needs_human',
    taskRunStatus: 'needs_human',
    reviewVerdict: 'needs_human',
    source: 'reviewer',
  };
}

function createMockAdapter() {
  return {
    id: 'mock',
    tool: 'mock-agent',
    model: 'mock',
    execute({ task, args }) {
      const outcome = decideMockOutcome(task, args);
      return {
        ...outcome,
        agent: {
          tool: 'mock-agent',
          model: 'mock',
        },
        changedFiles: [],
        checks: [],
        summary: outcome.taskRunStatus === 'passed'
          ? `mock agent completed ${task.id}`
          : `mock agent marked ${task.id} as ${outcome.taskRunStatus}`,
        errors: [],
        nextActions: outcome.taskRunStatus === 'passed' ? [] : ['下一轮自动重试或人工处理。'],
      };
    },
  };
}

export { createMockAdapter };
