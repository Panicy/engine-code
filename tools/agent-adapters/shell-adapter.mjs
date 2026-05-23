import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function outputSummary(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return output ? output.slice(0, 1000) : `exit ${result.status ?? 'unknown'}`;
}

function createShellAdapter() {
  return {
    id: 'shell',
    tool: 'shell',
    model: 'local',
    execute({ args, task, taskContext, taskContextPath }) {
      const command = args['shell-command'];
      if (!command) {
        return {
          requestedStatus: 'needs_human',
          taskRunStatus: 'needs_human',
          reviewVerdict: null,
          source: 'executor',
          agent: { tool: 'shell', model: 'local' },
          changedFiles: [],
          checks: [],
          summary: 'shell adapter 缺少 --shell-command。',
          errors: ['缺少 --shell-command'],
          nextActions: ['提供 --shell-command 后重跑。'],
        };
      }

      const cwd = taskContext.base.workspaceAbs;
      if (!fs.existsSync(cwd)) {
        return {
          requestedStatus: 'needs_human',
          taskRunStatus: 'needs_human',
          reviewVerdict: null,
          source: 'executor',
          agent: { tool: 'shell', model: 'local' },
          changedFiles: [],
          checks: [],
          summary: `base workspace 不存在：${cwd}`,
          errors: [`base workspace 不存在：${cwd}`],
          nextActions: ['初始化或修正 project.bases[].workspace 后重跑。'],
        };
      }

      const timeoutMs = Number.parseInt(args['shell-timeout-ms'] ?? '300000', 10);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
        return {
          requestedStatus: 'needs_human',
          taskRunStatus: 'needs_human',
          reviewVerdict: null,
          source: 'executor',
          agent: { tool: 'shell', model: 'local' },
          changedFiles: [],
          checks: [],
          summary: '--shell-timeout-ms 必须是大于等于 1000 的整数。',
          errors: ['非法 --shell-timeout-ms'],
          nextActions: ['修正 --shell-timeout-ms 后重跑。'],
        };
      }

      const result = spawnSync(command, {
        cwd,
        shell: true,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ENGINE_TASK_CONTEXT_PATH: taskContextPath ?? '',
          ENGINE_REQUIRED_SKILL_ID: task.requiredSkillId,
          ENGINE_SKILL_DOCUMENT_PATH: taskContext.skill?.documentPath ?? '',
          ENGINE_SKILL_DOCUMENT_SHA256: taskContext.skill?.documentSha256 ?? '',
        },
      });
      const summary = outputSummary(result);
      if (result.status === 0) {
        return {
          requestedStatus: 'done',
          taskRunStatus: 'passed',
          reviewVerdict: 'pass',
          source: 'executor',
          agent: { tool: 'shell', model: 'local' },
          changedFiles: [],
          checks: [],
          summary,
          errors: [],
          nextActions: [],
        };
      }
      return {
        requestedStatus: 'needs_human',
        taskRunStatus: 'needs_human',
        reviewVerdict: null,
        source: 'executor',
        agent: { tool: 'shell', model: 'local' },
        changedFiles: [],
        checks: [],
        summary,
        errors: [`shell command failed: ${command}`],
        nextActions: ['检查 shell command 输出并人工处理。'],
      };
    },
  };
}

export { createShellAdapter };
