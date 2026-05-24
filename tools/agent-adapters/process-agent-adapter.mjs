import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function readTextIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function outputSummary(result, logs = []) {
  const output = [
    result.stdout,
    result.stderr,
    ...logs.map((log) => readTextIfExists(log.path)),
  ].filter(Boolean).join('\n').trim();
  return output ? output.slice(0, 1000) : `exit ${result.status ?? 'unknown'}`;
}

function outputText(result, logs = []) {
  return [
    result.stdout,
    result.stderr,
    ...logs.map((log) => readTextIfExists(log.path)),
  ].filter(Boolean).join('\n');
}

function indicatesWriteBlocked(output) {
  return [
    /sandbox:\s*read-?only/i,
    /read-?only\s+(?:file\s+)?system/i,
    /只读(?:文件系统|目录|模式|sandbox)/,
    /环境只读/,
    /无法写(?:入|文件)?/,
    /不能写(?:入|文件)?/,
    /permission denied/i,
    /operation not permitted/i,
  ].some((pattern) => pattern.test(output));
}

function normalizeExtraArgs(value, defaultExtraArgs = []) {
  if (!value) return defaultExtraArgs;
  return Array.isArray(value) ? value : [value];
}

function buildPrompt(taskContextPath, label) {
  return [
    `请读取 task-context 文件：${taskContextPath}`,
    '只执行该 task，不要扩展到其他任务。',
    '遵守 task-context 中的 scope、executionHints.allowedPaths、checks 和 skill 文档。',
    '不要提交代码，不要 push，不要创建 PR。',
    '不要自报 changedFiles；可信 changedFiles 由 Run Loop 的 git diff collector 采集。',
    `你当前是 ${label} 执行器。完成后输出简短 summary；如果无法完成，请说明原因。`,
  ].join('\n');
}

function needsHuman({ tool, model, summary, errors, nextActions = ['检查 Agent Adapter 输出并人工处理。'] }) {
  return {
    requestedStatus: 'needs_human',
    taskRunStatus: 'needs_human',
    reviewVerdict: null,
    source: 'executor',
    agent: { tool, model },
    changedFiles: [],
    checks: [],
    summary,
    logs: [],
    errors,
    nextActions,
  };
}

function prepareProcessLogs({ taskContextPath, id, attempt }) {
  if (!taskContextPath) return { stdio: ['ignore', 'pipe', 'pipe'], logs: [], close: () => {} };
  const taskDir = path.dirname(taskContextPath);
  fs.mkdirSync(taskDir, { recursive: true });
  const suffix = `attempt-${attempt ?? 'unknown'}`;
  const stdoutPath = path.join(taskDir, `${id}-${suffix}-stdout.log`);
  const stderrPath = path.join(taskDir, `${id}-${suffix}-stderr.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  return {
    stdio: ['ignore', stdoutFd, stderrFd],
    logs: [
      { type: 'stdout', path: stdoutPath },
      { type: 'stderr', path: stderrPath },
    ],
    close: () => {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    },
  };
}

function createProcessAgentAdapter(config) {
  const {
    id,
    tool,
    model,
    argPrefix,
    defaultCommand,
    defaultExtraArgs = [],
    defaultTimeoutMs = '300000',
    supportsModelArg = false,
    label = id,
  } = config;

  return {
    id,
    tool,
    model,
    execute({ args, taskContext, taskContextPath, attempt }) {
      const command = args[`${argPrefix}-command`] ?? defaultCommand;
      const cwd = taskContext.base.workspaceAbs;
      const currentModel = args[`${argPrefix}-model`] ?? model;
      if (!command) {
        return needsHuman({
          tool,
          model: currentModel,
          summary: `${id} adapter 缺少 --${argPrefix}-command。`,
          errors: [`缺少 --${argPrefix}-command`],
          nextActions: [`提供 --${argPrefix}-command 后重跑。`],
        });
      }
      if (!fs.existsSync(cwd)) {
        return needsHuman({
          tool,
          model: currentModel,
          summary: `base workspace 不存在：${cwd}`,
          errors: [`base workspace 不存在：${cwd}`],
          nextActions: ['初始化或修正 project.bases[].workspace 后重跑。'],
        });
      }
      if (!taskContextPath) {
        return needsHuman({
          tool,
          model: currentModel,
          summary: `${id} adapter 缺少 task-context 路径。`,
          errors: ['缺少 taskContextPath'],
          nextActions: ['检查 Run Loop 是否传递 taskContextPath。'],
        });
      }

      const timeoutRaw = args[`${argPrefix}-timeout-ms`] ?? defaultTimeoutMs;
      const timeoutMs = /^\d+$/.test(timeoutRaw) ? Number.parseInt(timeoutRaw, 10) : Number.NaN;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
        return needsHuman({
          tool,
          model: currentModel,
          summary: `--${argPrefix}-timeout-ms 必须是大于等于 1000 的整数。`,
          errors: [`非法 --${argPrefix}-timeout-ms`],
          nextActions: [`修正 --${argPrefix}-timeout-ms 后重跑。`],
        });
      }

      const spawnArgs = [
        ...normalizeExtraArgs(args[`${argPrefix}-extra-arg`], defaultExtraArgs),
      ];
      if (supportsModelArg && args[`${argPrefix}-model`]) {
        spawnArgs.push('--model', args[`${argPrefix}-model`]);
      }
      spawnArgs.push(buildPrompt(taskContextPath, label));

      const processLogs = prepareProcessLogs({ taskContextPath, id, attempt });
      let result;
      try {
        result = spawnSync(command, spawnArgs, {
          cwd,
          shell: false,
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: processLogs.stdio,
        });
      } finally {
        processLogs.close();
      }
      const summary = outputSummary(result, processLogs.logs);
      if (result.error) {
        const isTimeout = result.error.code === 'ETIMEDOUT';
        const message = isTimeout ? `${id} command timeout after ${timeoutMs}ms` : `${id} command failed to start: ${result.error.message}`;
        return {
          ...needsHuman({
            tool,
            model: currentModel,
            summary: message,
            errors: [message],
          }),
          logs: processLogs.logs,
        };
      }
      if (result.status !== 0) {
        return {
          ...needsHuman({
            tool,
            model: currentModel,
            summary,
            errors: [`${id} command exited with status ${result.status}: ${command}`],
          }),
          logs: processLogs.logs,
        };
      }
      if (indicatesWriteBlocked(outputText(result, processLogs.logs))) {
        return {
          ...needsHuman({
            tool,
            model: currentModel,
            summary: `${id} adapter 输出显示执行环境不可写：${summary}`,
            errors: [`${id} adapter write blocked`],
            nextActions: [
              `请用可写 sandbox 重跑，例如为 Codex 使用 --${argPrefix}-extra-arg --sandbox --${argPrefix}-extra-arg workspace-write。`,
              '如任务已被误标为 done，可使用 recovery retry --allow-done 合规恢复后重跑。',
            ],
          }),
          logs: processLogs.logs,
        };
      }
      return {
        requestedStatus: 'done',
        taskRunStatus: 'passed',
        reviewVerdict: 'pass',
        source: 'executor',
        agent: { tool, model: currentModel },
        changedFiles: [],
        checks: [],
        summary,
        logs: processLogs.logs,
        errors: [],
        nextActions: [],
      };
    },
  };
}

export { createProcessAgentAdapter };
