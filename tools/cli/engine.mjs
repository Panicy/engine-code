#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const defaultProjectsRoot = path.resolve(repoRoot, '..', 'sk-projects');

const defaultBases = {
  backend: {
    templateId: 'backend-starter',
    repo: 'https://gitee.com/Panicy/backend-starter',
  },
  middle: {
    templateId: 'middle-starter',
    repo: 'https://gitee.com/Panicy/middle-starter',
  },
  client: {
    templateId: 'uniapp-template',
    repo: 'https://gitee.com/Panicy/uniapp-template',
  },
};

function usage() {
  return [
    '用法：engine <command> [options]',
    '',
    'Commands:',
    '  init-project   创建 project.json',
    '  init-feature   创建并可确认 prd/task-plan/run-state',
    '  runtime        执行 Runtime Profile 检查',
    '  run            执行 Run Loop',
    '  real-test      执行固定三端基座真实项目测试',
    '  status         查看异常任务',
    '  show-task      查看单个 task 运行记录',
    '  retry          将异常 task 恢复为 ready',
    '  cancel         取消 needs_human task',
    '',
    'Examples:',
    '  engine init-project --project-id demo --name 示例 --project-dir ../sk-projects/demo --backend /path/backend --middle /path/middle',
    '  engine init-feature --project-dir ../sk-projects/demo --feature-id app --name 应用管理 --summary 管理应用 --bases backend,middle --approve --by human',
    '  engine runtime --project-dir ../sk-projects/demo --feature-id app --mode mock',
    '  engine run --project-dir ../sk-projects/demo --feature-id app --runtime-mode mock --checks-mode mock',
    '  MYSQL_PWD=romantic. engine real-test --mysql-command /usr/local/mysql/bin/mysql --mysql-user root --mysql-password-env MYSQL_PWD --database aitest --redis-url redis://default:root123@127.0.0.1:6379',
    '  engine status --project-dir ../sk-projects/demo --feature-id app',
  ].join('\n');
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (['force', 'approve', 'keep-tmp', 'skip-bootstrap'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    if (key === 'base') {
      options.base = [...(options.base ?? []), value];
    } else if (['codex-extra-arg', 'external-agent-extra-arg'].includes(key)) {
      options[key] = [...(options[key] ?? []), value];
    } else {
      options[key] = value;
    }
    i += 1;
  }
  return options;
}

function requireOption(options, key) {
  if (!options[key]) throw new Error(`缺少参数 --${key}`);
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function projectRoot(projectId, options = {}) {
  if (options['project-dir']) return options['project-dir'];
  return path.join(options['projects-root'] ?? defaultProjectsRoot, projectId);
}

function defaultProjectPath(projectId, options = {}) {
  return path.join(projectRoot(projectId, options), 'project.json');
}

function featureDirFromProject(projectPath, featureId) {
  return path.join(path.dirname(projectPath), 'features', featureId);
}

function inferProjectPath(options) {
  if (options.project) return options.project;
  if (options['project-dir']) return path.join(options['project-dir'], 'project.json');
  if (options['project-id']) return defaultProjectPath(options['project-id'], options);
  throw new Error('缺少 --project、--project-dir 或 --project-id');
}

function inferFeatureDir(options) {
  if (options.feature) return options.feature;
  requireOption(options, 'feature-id');
  return featureDirFromProject(inferProjectPath(options), options['feature-id']);
}

function featureFiles(featureDir) {
  return {
    prd: path.join(featureDir, 'prd.json'),
    taskPlan: path.join(featureDir, 'task-plan.json'),
    runState: path.join(featureDir, 'run-state.json'),
  };
}

function initProject(options) {
  requireOption(options, 'project-id');
  requireOption(options, 'name');
  const out = options.out ?? defaultProjectPath(options['project-id'], options);
  const bases = [...(options.base ?? [])];
  for (const baseId of ['backend', 'middle', 'client']) {
    if (!options[baseId]) continue;
    const defaults = defaultBases[baseId];
    bases.push(`${baseId}:${defaults.templateId}:${defaults.repo}:${options[baseId]}`);
  }
  if (bases.length === 0) throw new Error('至少提供一个 --base，或使用 --backend/--middle/--client 指定 workspace');
  const args = [
    'tools/project-init/create-project.mjs',
    '--project-id', options['project-id'],
    '--name', options.name,
    '--out', out,
  ];
  if (options.description) args.push('--description', options.description);
  for (const base of bases) args.push('--base', base);
  if (options.force) args.push('--force');
  runNode(args[0], args.slice(1));
}

function initFeature(options) {
  requireOption(options, 'feature-id');
  requireOption(options, 'name');
  requireOption(options, 'summary');
  const project = inferProjectPath(options);
  const outDir = options['out-dir'] ?? inferFeatureDir({ ...options, project });
  const args = [
    'tools/project-init/create-feature.mjs',
    '--feature-id', options['feature-id'],
    '--name', options.name,
    '--summary', options.summary,
    '--project', project,
    '--bases', options.bases ?? 'backend,middle',
    '--out-dir', outDir,
  ];
  if (options.approve) {
    const by = options.by ?? 'human';
    args.push('--approve-prd-by', by, '--approve-task-plan-by', by);
  } else {
    if (options['approve-prd-by']) args.push('--approve-prd-by', options['approve-prd-by']);
    if (options['approve-task-plan-by']) args.push('--approve-task-plan-by', options['approve-task-plan-by']);
  }
  if (options['requirements-file']) args.push('--requirements-file', options['requirements-file']);
  if (options.force) args.push('--force');
  runNode(args[0], args.slice(1));
}

function runtime(options) {
  const featureDir = inferFeatureDir(options);
  const project = inferProjectPath(options);
  const args = [
    'tools/runtime-runner/run-runtime.mjs',
    '--project', project,
    '--out-dir', options['out-dir'] ?? path.join(featureDir, 'runs', 'runtime'),
    '--mode', options.mode ?? 'check',
  ];
  if (options['base-ids']) args.push('--base-ids', options['base-ids']);
  if (options['templates-dir']) args.push('--templates-dir', options['templates-dir']);
  if (options['timeout-ms']) args.push('--timeout-ms', options['timeout-ms']);
  runNode(args[0], args.slice(1));
}

function run(options) {
  const featureDir = inferFeatureDir(options);
  const project = inferProjectPath(options);
  const files = featureFiles(featureDir);
  const args = [
    'tools/run-loop/run-feature.mjs',
    '--project', project,
    '--prd', options.prd ?? files.prd,
    '--task-plan', options['task-plan'] ?? files.taskPlan,
    '--run-state', options['run-state'] ?? files.runState,
    '--agent-adapter', options['agent-adapter'] ?? 'mock',
    '--checks-mode', options['checks-mode'] ?? 'mock',
    '--runtime-mode', options['runtime-mode'] ?? 'skip',
  ];
  for (const key of [
    'templates-dir',
    'max-tasks',
    'mock-fail-task',
    'mock-fail-stage',
    'mock-fail-check',
    'shell-command',
    'shell-timeout-ms',
    'codex-command',
    'codex-model',
    'codex-timeout-ms',
    'external-agent-command',
    'external-agent-timeout-ms',
    'owner',
  ]) {
    if (options[key]) args.push(`--${key}`, options[key]);
  }
  for (const value of options['codex-extra-arg'] ?? []) args.push('--codex-extra-arg', value);
  for (const value of options['external-agent-extra-arg'] ?? []) args.push('--external-agent-extra-arg', value);
  runNode(args[0], args.slice(1));
}

function realTest(options) {
  const args = ['tools/real-project-runner/run-real-project.mjs'];
  for (const key of [
    'project-id',
    'project-name',
    'tmp-root',
    'clone-mode',
    'mysql-command',
    'mysql-host',
    'mysql-port',
    'mysql-user',
    'mysql-password-env',
    'mysql-password-source',
    'database',
    'redis-url',
    'redis-command',
    'adapter',
    'codex-command',
    'scenario-ids',
  ]) {
    if (options[key]) args.push(`--${key}`, options[key]);
  }
  if (options['keep-tmp']) args.push('--keep-tmp');
  if (options['skip-bootstrap']) args.push('--skip-bootstrap');
  runNode(args[0], args.slice(1));
}

function status(options) {
  const featureDir = inferFeatureDir(options);
  const files = featureFiles(featureDir);
  runNode('tools/recovery/list-issues.mjs', ['--run-state', options['run-state'] ?? files.runState]);
}

function showTask(options) {
  requireOption(options, 'task-id');
  const featureDir = inferFeatureDir(options);
  const files = featureFiles(featureDir);
  runNode('tools/recovery/show-task.mjs', [
    '--feature-dir', featureDir,
    '--run-state', options['run-state'] ?? files.runState,
    '--task-id', options['task-id'],
  ]);
}

function resolveTask(options, action) {
  requireOption(options, 'task-id');
  requireOption(options, 'by');
  requireOption(options, 'reason');
  const featureDir = inferFeatureDir(options);
  const files = featureFiles(featureDir);
  runNode('tools/recovery/resolve-task.mjs', [
    '--run-state', options['run-state'] ?? files.runState,
    '--task-id', options['task-id'],
    '--action', action,
    '--by', options.by,
    '--reason', options.reason,
  ]);
}

function main() {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === '--help' || command === '-h') {
      console.log(usage());
      return;
    }
    const options = parseOptions(rest);
    const handlers = {
      'init-project': initProject,
      'init-feature': initFeature,
      runtime,
      run,
      'real-test': realTest,
      status,
      'show-task': showTask,
      retry: (opts) => resolveTask(opts, 'retry'),
      cancel: (opts) => resolveTask(opts, 'cancel'),
    };
    const handler = handlers[command];
    if (!handler) throw new Error(`未知命令：${command}\n\n${usage()}`);
    handler(options);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

main();
