#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const defaultProjectsRoot = path.resolve(repoRoot, '..', 'engin-projects');

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
    '用法：sk <command> [options]',
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
    '  sk init-project 示例项目',
    '  sk init-feature --project-dir ../engin-projects/demo --feature-id app --name 应用管理 --summary 管理应用 --bases backend,middle --approve --by human',
    '  sk runtime --project-dir ../engin-projects/demo --feature-id app --mode mock',
    '  sk run --project-dir ../engin-projects/demo --feature-id app --runtime-mode mock --checks-mode mock',
    '  MYSQL_PWD=romantic. sk real-test --mysql-command /usr/local/mysql/bin/mysql --mysql-user root --mysql-password-env MYSQL_PWD --database aitest --redis-url redis://default:root123@127.0.0.1:6379',
    '  sk status --project-dir ../engin-projects/demo --feature-id app',
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
    if (['force', 'approve', 'keep-tmp', 'skip-bootstrap', 'skip-bases'].includes(key)) {
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

function slugifyProjectName(name) {
  const source = String(name ?? '').trim();
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug;
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 10);
  return `project-${hash}`;
}

function projectDirectoryName(name) {
  return String(name ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/^\.+$/, '')
    .replace(/^-+|-+$/g, '') || slugifyProjectName(name);
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  if (!options.quiet && result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 600000,
  });
  if (!options.quiet && result.stdout) process.stdout.write(result.stdout);
  if (!options.quiet && result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`命令失败：${command} ${args.join(' ')}`);
  }
  return result;
}

function projectRoot(projectId, options = {}) {
  if (options['project-dir']) return options['project-dir'];
  return path.join(options['projects-root'] ?? defaultProjectsRoot, projectId);
}

function defaultProjectPath(projectId, options = {}) {
  return path.join(projectRoot(projectId, options), 'project.json');
}

function resolveRepoPath(filePath) {
  return path.resolve(repoRoot, filePath);
}

function readJsonFile(filePath) {
  const abs = resolveRepoPath(filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function assertValidProjectFile(projectPath) {
  const abs = resolveRepoPath(projectPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`当前目录不是引擎项目：未找到 ${abs}。请先执行 sk init-project <项目名称>，或传入正确的 --project-dir/--project。`);
  }
  if (!fs.statSync(abs).isFile()) {
    throw new Error(`当前目录不是引擎项目：${abs} 不是 project.json 文件。`);
  }
  let project;
  try {
    project = readJsonFile(projectPath);
  } catch (error) {
    throw new Error(`当前目录不是合法引擎项目：${abs} 不是有效 JSON。${error.message}`);
  }
  const schema = readJsonFile('schemas/project.schema.json');
  const errors = validateSchema(project, schema, { file: projectPath, rootSchema: schema });
  if (errors.length > 0) {
    throw new Error(`当前目录不是合法引擎项目：${abs} 不符合 project.schema.json。\n${JSON.stringify(errors, null, 2)}`);
  }
  return project;
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

function parseBaseString(value) {
  const parts = value.split(':');
  const [baseId, templateId, ...rest] = parts;
  const workspace = rest.pop();
  const repo = rest.join(':');
  return { baseId, templateId, repo, workspace };
}

function prepareBaseWorkspace(base, cloneMode, force) {
  if (!base.workspace) throw new Error(`base ${base.baseId} 缺少 workspace`);
  if (fs.existsSync(base.workspace)) {
    const entries = fs.readdirSync(base.workspace).filter((entry) => entry !== '.DS_Store');
    if (entries.length > 0) {
      if (!force) throw new Error(`base workspace 已存在且非空：${base.workspace}。如确认覆盖，请先清理目录或使用 --skip-bases。`);
      return { baseId: base.baseId, workspace: base.workspace, skipped: true, reason: 'workspace exists' };
    }
  }
  fs.mkdirSync(path.dirname(base.workspace), { recursive: true });
  if (cloneMode === 'source-template') {
    const source = path.resolve(repoRoot, '.engine/source-templates', base.templateId);
    if (!fs.existsSync(source)) throw new Error(`source template 不存在：${source}`);
    fs.cpSync(source, base.workspace, {
      recursive: true,
      filter: (sourcePath) => !sourcePath.includes(`${path.sep}.git${path.sep}`) && !sourcePath.endsWith(`${path.sep}.git`),
    });
    runCommand('git', ['init'], { cwd: base.workspace, quiet: true });
    runCommand('git', ['config', 'user.email', 'sk@example.test'], { cwd: base.workspace, quiet: true });
    runCommand('git', ['config', 'user.name', 'SK Engine'], { cwd: base.workspace, quiet: true });
    runCommand('git', ['remote', 'add', 'origin', base.repo], { cwd: base.workspace, quiet: true });
    runCommand('git', ['add', '.'], { cwd: base.workspace, quiet: true });
    runCommand('git', ['commit', '-m', 'baseline'], { cwd: base.workspace, quiet: true });
    return { baseId: base.baseId, workspace: base.workspace, cloneMode };
  }
  if (cloneMode !== 'git') throw new Error('--clone-mode 必须是 git 或 source-template');
  runCommand('git', ['clone', '--depth', '1', base.repo, base.workspace], { timeoutMs: 600000, quiet: true });
  return { baseId: base.baseId, workspace: base.workspace, cloneMode };
}

function toProjectRelative(projectDir, filePath) {
  const absFilePath = path.resolve(repoRoot, filePath);
  const relative = path.relative(projectDir, absFilePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function writeFileIfAllowed(filePath, content, force) {
  if (fs.existsSync(filePath) && force !== true) {
    throw new Error(`约定文件已存在，拒绝覆盖：${filePath}。如确认覆盖，请使用 --force。`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function renderEngineMarkdown(project, projectDir) {
  const bases = (project.bases ?? [])
    .map((base) => [
      `### ${base.baseId}`,
      '',
      `- templateId: \`${base.templateId}\``,
      `- repo: \`${base.repo}\``,
      `- workspace: \`${toProjectRelative(projectDir, base.workspace)}\``,
    ].join('\n'))
    .join('\n\n');
  return [
    `# ${project.name} 引擎项目约定`,
    '',
    '本项目由 `sk engine` 管理。AI 编辑器和开发者都应围绕 PRD、任务拆分、skill、Run Loop 协作，不要绕过引擎直接开发未知功能。',
    '',
    '## 核心流程',
    '',
    '1. 使用 `sk init-feature` 创建功能 PRD。',
    '2. 人工确认 PRD 和任务拆分。',
    '3. 使用 `sk run` 执行开发循环。',
    '4. 使用 `sk status` 查看异常任务。',
    '5. 使用 `sk retry` 或 `sk cancel` 处理异常状态。',
    '',
    '## 常用命令',
    '',
    '```bash',
    'sk init-feature --project-dir . --feature-id app-management --name 应用管理 --summary 应用的新增、编辑、启停、查询和权限控制',
    '',
    'sk init-feature --project-dir . --feature-id app-management --name 应用管理 --summary 应用的新增、编辑、启停、查询和权限控制 --approve --by human',
    '',
    'sk run --project-dir . --feature-id app-management --runtime-mode check --checks-mode real',
    '',
    'sk status --project-dir . --feature-id app-management',
    '```',
    '',
    '## 项目结构',
    '',
    '```text',
    'project.json',
    'ENGINE.md',
    '.engine-workspace.json',
    'bases/',
    '  backend/',
    '  middle/',
    '  client/',
    'features/',
    '  <feature-id>/',
    '    prd.json',
    '    task-plan.json',
    '    run-state.json',
    '    runs/',
    '```',
    '',
    '## AI 编辑器规则',
    '',
    '- 开发前必须先读取本文件、`project.json`、对应功能的 `prd.json`、`task-plan.json` 和 `run-state.json`。',
    '- 不要凭空开发功能；必须基于 `task-plan.json` 中的 task 执行。',
    '- 每个 task 必须遵守 `requiredSkillId` 绑定的 skill。',
    '- 不要修改 `allowedPaths` 外的文件；越界修改会被 Review Runner 标记为失败。',
    '- 不要手动篡改 `run-state.json`、`task-run.json`、`review.json` 等运行产物。',
    '- 数据库变更必须进入任务上下文和 SQL/迁移文件，不能只改业务代码。',
    '- 接口开发应覆盖 401、403、404、菜单权限、鉴权关闭测试和鉴权恢复测试等检查。',
    '',
    '## 三端基座',
    '',
    bases,
    '',
    '## 机器可读约定',
    '',
    'AI 编辑器或后续 UI 可以读取 `.engine-workspace.json` 获取项目入口、默认命令和目录约定。',
    '',
  ].join('\n');
}

function buildEngineWorkspace(project, projectDir) {
  return {
    schemaVersion: '0.1.0',
    kind: 'sk-engine-workspace',
    projectId: project.projectId,
    name: project.name,
    projectDir: '.',
    files: {
      project: 'project.json',
      guide: 'ENGINE.md',
      featuresDir: 'features',
      runsDir: 'features/<featureId>/runs',
      prd: 'features/<featureId>/prd.json',
      taskPlan: 'features/<featureId>/task-plan.json',
      runState: 'features/<featureId>/run-state.json',
      taskContext: 'features/<featureId>/runs/<taskId>/task-context.json',
    },
    defaults: {
      agentAdapter: 'codex',
      runtimeMode: 'check',
      checksMode: 'real',
    },
    commands: {
      initFeature: 'sk init-feature --project-dir . --feature-id <featureId> --name <功能名称> --summary <功能摘要>',
      approveFeature: 'sk init-feature --project-dir . --feature-id <featureId> --name <功能名称> --summary <功能摘要> --approve --by human',
      run: 'sk run --project-dir . --feature-id <featureId> --runtime-mode check --checks-mode real',
      status: 'sk status --project-dir . --feature-id <featureId>',
      retry: 'sk retry --project-dir . --feature-id <featureId> --task-id <taskId> --by human --reason <原因>',
      cancel: 'sk cancel --project-dir . --feature-id <featureId> --task-id <taskId> --by human --reason <原因>',
    },
    bases: (project.bases ?? []).map((base) => ({
      baseId: base.baseId,
      templateId: base.templateId,
      repo: base.repo,
      workspace: toProjectRelative(projectDir, base.workspace),
    })),
    aiEditorRules: [
      '先读取 ENGINE.md 和 project.json。',
      '基于 prd.json、task-plan.json、run-state.json 判断当前任务。',
      '按 task.requiredSkillId 对应 skill 执行。',
      '不要修改 allowedPaths 外的文件。',
      '不要手动篡改 run-state 或运行产物。',
    ],
  };
}

function writeProjectConventions(project, projectDir, force) {
  const guidePath = path.join(projectDir, 'ENGINE.md');
  const workspacePath = path.join(projectDir, '.engine-workspace.json');
  writeFileIfAllowed(guidePath, `${renderEngineMarkdown(project, projectDir)}\n`, force);
  writeFileIfAllowed(workspacePath, `${JSON.stringify(buildEngineWorkspace(project, projectDir), null, 2)}\n`, force);
  return {
    guidePath,
    workspacePath,
  };
}

function initProject(options) {
  const name = options.name ?? options._.join(' ');
  if (!name) throw new Error('缺少参数 --name，或在 init-project 后直接输入项目名称');
  const projectId = options['project-id'] ?? slugifyProjectName(name);
  const root = options['project-dir'] ?? (options.out ? path.dirname(options.out) : path.join(options['projects-root'] ?? defaultProjectsRoot, projectDirectoryName(name)));
  const out = options.out ?? path.join(root, 'project.json');
  const bases = [...(options.base ?? [])];
  const hasExplicitBases = (options.base ?? []).length > 0 || Boolean(options.backend || options.middle || options.client);
  if (!hasExplicitBases) {
    for (const baseId of ['backend', 'middle', 'client']) {
      const defaults = defaultBases[baseId];
      bases.push(`${baseId}:${defaults.templateId}:${defaults.repo}:${path.join(root, 'bases', baseId)}`);
    }
  } else {
    for (const baseId of ['backend', 'middle', 'client']) {
      if (!options[baseId]) continue;
      const defaults = defaultBases[baseId];
      bases.push(`${baseId}:${defaults.templateId}:${defaults.repo}:${options[baseId]}`);
    }
  }
  const args = [
    'tools/project-init/create-project.mjs',
    '--project-id', projectId,
    '--name', name,
    '--out', out,
  ];
  if (options.description) args.push('--description', options.description);
  for (const base of bases) args.push('--base', base);
  if (!hasExplicitBases) {
    args.push('--allow-missing-workspace');
  }
  if (options.force) args.push('--force');
  const projectResult = runNode(args[0], args.slice(1), { quiet: true });
  const projectSummary = JSON.parse(projectResult.stdout);
  const project = readJsonFile(out);
  const conventionFiles = writeProjectConventions(project, path.dirname(out), options.force);
  const preparedBases = [];
  const shouldPrepareBases = !hasExplicitBases && !options['skip-bases'];
  if (shouldPrepareBases) {
    const cloneMode = options['clone-mode'] ?? 'git';
    preparedBases.push(...bases.map((base) => prepareBaseWorkspace(parseBaseString(base), cloneMode, options.force)));
  }
  console.log(JSON.stringify({
    ...projectSummary,
    projectDir: path.dirname(out),
    conventionFiles,
    basesPrepared: shouldPrepareBases,
    preparedBases,
  }, null, 2));
}

function initFeature(options) {
  requireOption(options, 'feature-id');
  requireOption(options, 'name');
  requireOption(options, 'summary');
  const project = inferProjectPath(options);
  assertValidProjectFile(project);
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
