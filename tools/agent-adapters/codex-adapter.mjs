import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function outputSummary(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return output ? output.slice(0, 1000) : `exit ${result.status ?? 'unknown'}`;
}

function needsHuman({ summary, errors, nextActions = ['检查 Codex Adapter 输出并人工处理。'] }) {
  return {
    requestedStatus: 'needs_human',
    taskRunStatus: 'needs_human',
    reviewVerdict: null,
    source: 'executor',
    agent: { tool: 'codex', model: 'codex' },
    changedFiles: [],
    checks: [],
    summary,
    errors,
    nextActions,
  };
}

function normalizeExtraArgs(value) {
  if (!value) return ['exec'];
  return Array.isArray(value) ? value : [value];
}

function buildPrompt(taskContextPath) {
  return [
    `请读取 task-context 文件：${taskContextPath}`,
    '只执行该 task，不要扩展到其他任务。',
    '遵守 task-context 中的 scope、executionHints.allowedPaths、checks 和 skill 文档。',
    '不要提交代码，不要 push，不要创建 PR。',
    '不要自报 changedFiles；可信 changedFiles 由 Run Loop 的 git diff collector 采集。',
    '完成后输出简短 summary；如果无法完成，请说明原因。',
  ].join('\n');
}

function createCodexAdapter() {
  return {
    id: 'codex',
    tool: 'codex',
    model: 'codex',
    execute({ args, taskContext, taskContextPath }) {
      const command = args['codex-command'] ?? 'codex';
      const cwd = taskContext.base.workspaceAbs;
      if (!fs.existsSync(cwd)) {
        return needsHuman({
          summary: `base workspace 不存在：${cwd}`,
          errors: [`base workspace 不存在：${cwd}`],
          nextActions: ['初始化或修正 project.bases[].workspace 后重跑。'],
        });
      }
      if (!taskContextPath) {
        return needsHuman({
          summary: 'codex adapter 缺少 task-context 路径。',
          errors: ['缺少 taskContextPath'],
          nextActions: ['检查 Run Loop 是否传递 taskContextPath。'],
        });
      }

      const timeoutRaw = args['codex-timeout-ms'] ?? '300000';
      const timeoutMs = /^\d+$/.test(timeoutRaw) ? Number.parseInt(timeoutRaw, 10) : Number.NaN;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
        return needsHuman({
          summary: '--codex-timeout-ms 必须是大于等于 1000 的整数。',
          errors: ['非法 --codex-timeout-ms'],
          nextActions: ['修正 --codex-timeout-ms 后重跑。'],
        });
      }

      const spawnArgs = [
        ...normalizeExtraArgs(args['codex-extra-arg']),
      ];
      if (args['codex-model']) {
        spawnArgs.push('--model', args['codex-model']);
      }
      spawnArgs.push(buildPrompt(taskContextPath));

      const result = spawnSync(command, spawnArgs, {
        cwd,
        shell: false,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const summary = outputSummary(result);
      if (result.error) {
        const isTimeout = result.error.code === 'ETIMEDOUT';
        return needsHuman({
          summary: isTimeout ? `codex command timeout after ${timeoutMs}ms` : `codex command failed to start: ${result.error.message}`,
          errors: [isTimeout ? `codex command timeout after ${timeoutMs}ms` : `codex command failed to start: ${result.error.message}`],
        });
      }
      if (result.status !== 0) {
        return needsHuman({
          summary,
          errors: [`codex command exited with status ${result.status}: ${command}`],
        });
      }
      return {
        requestedStatus: 'done',
        taskRunStatus: 'passed',
        reviewVerdict: 'pass',
        source: 'executor',
        agent: { tool: 'codex', model: args['codex-model'] ?? 'codex' },
        changedFiles: [],
        checks: [],
        summary,
        errors: [],
        nextActions: [],
      };
    },
  };
}

export { createCodexAdapter };
