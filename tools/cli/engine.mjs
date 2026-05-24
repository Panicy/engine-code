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

function renderProjectGitignore() {
  return [
    'bases/',
    'node_modules/',
    '.DS_Store',
    '*.log',
    '',
  ].join('\n');
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
    '## 项目启动规则',
    '',
    'AI 编辑器打开本项目后，第一步必须读取以下文件：',
    '',
    '1. `ENGINE.md`',
    '2. `.engine-workspace.json`',
    '3. `project.json`',
    '',
    '在确认当前用户意图、目标 feature 和任务状态前，不允许修改 `bases/` 下任何业务代码。',
    '',
    '## 用户意图分类',
    '',
    '收到用户请求后，AI 编辑器必须先判断属于哪一类：',
    '',
    '- 新功能或新模块',
    '- 已有功能补充或复杂改造',
    '- 已有 feature/task 的继续执行',
    '- 失败任务修复或复跑',
    '- 运行、测试、排错、查看、解释、搜索',
    '- 文档或项目约定调整',
    '',
    '如果无法判断，应先向用户确认，不得自行假设后直接修改业务代码。',
    '',
    '以下情况可以不创建新 PRD：',
    '',
    '- 用户明确要求查看、解释、搜索或运行命令。',
    '- 用户要求继续当前已有 feature/task。',
    '- 用户要求修复 `run-state.json` 中已有失败任务。',
    '- 用户明确要求修改非业务文档、项目约定或引擎配置。',
    '',
    '除以上情况外，只要涉及业务功能代码修改，都必须先进入 PRD 和任务拆分流程。',
    '',
    '## 当用户提出新需求时',
    '',
    '当用户说“开发 XX 功能”“新增 XX 模块”“实现 XX 页面/接口”“优化 XX 流程”时，AI 编辑器必须先判断是否已有对应 feature。',
    '',
    '判断是否已有 feature 的方式：',
    '',
    '1. 查看 `features/` 目录。',
    '2. 读取每个 `features/<feature-id>/prd.json`。',
    '3. 对比 `name`、`summary`、用户故事、影响端和状态。',
    '4. 如果不确定是否复用已有 feature，必须询问用户。',
    '',
    '`feature-id` 必须使用小写英文、数字和短横线。中文功能名需要转成英文语义，例如：`应用管理 -> app-management`，`相册功能 -> album-management`，`订单管理 -> order-management`。',
    '',
    '如果没有对应 feature，必须先创建 PRD JSON：',
    '',
    '```bash',
    'sk init-feature --project-dir . --feature-id <featureId> --name <功能名称> --summary <功能摘要>',
    '```',
    '',
    '创建后只允许围绕 `features/<feature-id>/prd.json` 进行确认、补充或修订。PRD 未经人工确认前，不允许生成任务拆分，不允许修改 `bases/` 下的业务代码，不允许执行开发 Agent。',
    '',
    '生成 `prd.json` 后，AI 编辑器必须停下，向用户展示 PRD 摘要、影响端、风险和待确认问题，等待用户明确确认或修改。不得继续生成 `task-plan.json`。',
    '',
    'PRD 人工确认后，才允许生成 `task-plan.json` 和 `run-state.json`。任务拆分仍需人工确认；任务拆分未确认前，不允许进入 Run Loop。',
    '',
    '生成 `task-plan.json` 后，AI 编辑器必须再次停下，向用户展示任务拆分摘要、每个 task 的目标端、依赖、`requiredSkillId` 和验收检查，等待用户明确确认。不得直接执行 `sk run`。',
    '',
    '如果用户要求“直接做”“先写代码”，AI 编辑器也必须提醒：本项目受 `sk engine` 管理，新功能必须先进入 PRD JSON 和任务拆分确认流程。',
    '',
    '标准流转：',
    '',
    '```text',
    '用户自然语言需求',
    '  -> features/<feature-id>/prd.json',
    '  -> 人工确认 PRD',
    '  -> features/<feature-id>/task-plan.json',
    '  -> 人工确认任务拆分',
    '  -> sk run 执行开发循环',
    '```',
    '',
    '## 人工确认红线',
    '',
    'AI 编辑器不得代表 human 做人工确认。除非用户在当前对话中明确说出“确认 PRD”“确认任务拆分”“同意执行确认命令”等确认语义，否则 AI 不得执行任何带 `--approve`、`--approve-prd-by`、`--approve-task-plan-by` 或 `--by human` 的命令。',
    '',
    'AI 不得自称 human，不得为了推进流程自行填写人工确认人。',
    '',
    '## PRD 质量门禁',
    '',
    'PRD 至少应包含或明确说明以下内容：',
    '',
    '- 功能目标和非目标',
    '- 用户故事和主要使用流程',
    '- 影响端：backend、middle、client',
    '- 数据实体、核心字段和数据库变更',
    '- 权限点、菜单入口和角色范围',
    '- API 范围、401/403/404 等异常场景',
    '- 验收标准、测试要求、风险和 `openQuestions`',
    '',
    '如果需求缺少关键业务规则、字段、权限、页面入口、验收标准或存在 `openQuestions`，AI 必须先提问或补充到 PRD 中，不得自行脑补后开发。',
    '',
    '## 开发执行规则',
    '',
    '推荐由 Run Loop 调用 Agent Adapter 执行开发。如果用户要求 AI 编辑器手动开发，也必须先读取当前 task 对应的 `task-context.json`，并且一次只处理一个 task。',
    '',
    '每个 task 只能修改 `targetBaseId` 指向的基座和 `allowedPaths` 允许的文件。跨端功能必须由 `task-plan.json` 拆成多个 task，不允许一个 task 混改三端。',
    '',
    '## 常用命令',
    '',
    '```bash',
    'sk init-feature --project-dir . --feature-id app-management --name 应用管理 --summary 应用的新增、编辑、启停、查询和权限控制',
    '',
    '# 仅在用户明确确认 PRD 和任务拆分后执行，AI 不得自行代替 human 确认',
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
    '.gitignore',
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
    '- 打开项目后必须先读取 `ENGINE.md`、`.engine-workspace.json` 和 `project.json`。',
    '- 开发前必须先判断用户意图、目标 feature 和任务状态。',
    '- 在确认当前 feature 和 task 前，不允许修改 `bases/` 业务代码。',
    '- 用户提出新功能或复杂改造时，必须先进入 PRD JSON，不要直接修改 `bases/` 代码。',
    '- PRD 未人工确认前，不允许生成任务拆分或执行开发。',
    '- 任务拆分未人工确认前，不允许进入 Run Loop。',
    '- AI 不得代表 human 确认 PRD 或任务拆分，不得自行执行 `--by human`。',
    '- 生成 PRD 后必须停下等待用户确认；生成任务拆分后必须再次停下等待用户确认。',
    '- 不要凭空开发功能；必须基于 `task-plan.json` 中的 task 执行。',
    '- 每个 task 必须遵守 `requiredSkillId` 绑定的 skill。',
    '- 每次只处理一个 task，跨端功能必须拆分为多个 task。',
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
    'AI 编辑器或后续 UI 必须优先读取 `.engine-workspace.json` 中的 `intentRules`、`commands`、`files` 和 `aiEditorRules` 获取项目入口、默认命令和目录约定。',
    '',
    '## Git 约定',
    '',
    '项目根目录是独立 git 仓库，用于管理 `project.json`、`ENGINE.md`、`.engine-workspace.json` 和 `features/` 下的 PRD、任务拆分、运行状态等引擎产物。',
    '',
    '`bases/` 下的 backend、middle、client 是各自独立的业务代码仓库，不纳入项目根仓库提交。',
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
    intentRules: {
      boot: {
        requiredReads: ['ENGINE.md', '.engine-workspace.json', 'project.json'],
        forbiddenBeforeIntentResolved: ['edit_base_code', 'run_development_agent', 'change_run_state'],
      },
      directCodeEditExceptions: [
        'inspect_or_explain',
        'search_or_read',
        'run_or_debug_command',
        'continue_existing_feature_task',
        'fix_existing_failed_task',
        'edit_non_business_docs_or_engine_conventions',
      ],
      newFeature: {
        description: '用户提出新功能、新模块、新页面、新接口或复杂业务改造时必须执行的入口流程。',
        triggers: ['开发', '新增', '增加', '实现', '做一个', '优化', '改造', '页面', '接口', '模块', '功能'],
        requiredFlow: [
          'create_prd_json',
          'human_confirm_prd',
          'create_task_plan_json',
          'human_confirm_task_plan',
          'run_loop',
        ],
        forbiddenBeforePrdApproval: [
          'edit_base_code',
          'create_task_plan',
          'run_development_agent',
          'change_run_state',
          'use_approve_flags',
        ],
        forbiddenBeforeTaskPlanApproval: [
          'edit_base_code',
          'run_loop',
          'run_development_agent',
          'use_approve_flags',
        ],
        stopAfter: ['create_prd_json', 'create_task_plan_json'],
        requireHumanPhrases: ['确认 PRD', '确认任务拆分', '同意执行确认命令'],
        featureIdPattern: '^[a-z0-9][a-z0-9-]*$',
      },
    },
    approvalRules: {
      aiMayApproveAsHuman: false,
      forbiddenFlagsWithoutExplicitUserConfirmation: ['--approve', '--approve-prd-by', '--approve-task-plan-by', '--by human'],
      mustStopAfterPrdCreated: true,
      mustStopAfterTaskPlanCreated: true,
    },
    prdQualityGate: {
      requiredTopics: [
        'goals',
        'nonGoals',
        'userStories',
        'impactedBaseIds',
        'dataEntities',
        'permissions',
        'menuEntries',
        'apiScope',
        'acceptanceCriteria',
        'tests',
        'risks',
        'openQuestions',
      ],
      blockApprovalWhenOpenQuestionsExist: true,
      askUserWhenInformationMissing: true,
    },
    bases: (project.bases ?? []).map((base) => ({
      baseId: base.baseId,
      templateId: base.templateId,
      repo: base.repo,
      workspace: toProjectRelative(projectDir, base.workspace),
    })),
    aiEditorRules: [
      '先读取 ENGINE.md、.engine-workspace.json 和 project.json。',
      '先判断用户意图、目标 feature 和任务状态，不能直接改 bases/ 代码。',
      '用户提出新功能或复杂改造时，必须先创建或修订 features/<featureId>/prd.json。',
      'PRD 未人工确认前，不允许生成任务拆分或修改 bases/ 代码。',
      '任务拆分未人工确认前，不允许进入 Run Loop。',
      'AI 不得代表 human 确认 PRD 或任务拆分，不得自行执行 --by human。',
      '生成 PRD 后必须停下等待用户确认；生成任务拆分后必须再次停下等待用户确认。',
      '基于 prd.json、task-plan.json、run-state.json 判断当前任务。',
      '按 task.requiredSkillId 对应 skill 执行。',
      '每次只处理一个 task，跨端功能必须拆分为多个 task。',
      '不要修改 allowedPaths 外的文件。',
      '不要手动篡改 run-state 或运行产物。',
    ],
  };
}

function writeProjectConventions(project, projectDir, force) {
  const guidePath = path.join(projectDir, 'ENGINE.md');
  const workspacePath = path.join(projectDir, '.engine-workspace.json');
  const gitignorePath = path.join(projectDir, '.gitignore');
  writeFileIfAllowed(guidePath, `${renderEngineMarkdown(project, projectDir)}\n`, force);
  writeFileIfAllowed(workspacePath, `${JSON.stringify(buildEngineWorkspace(project, projectDir), null, 2)}\n`, force);
  writeFileIfAllowed(gitignorePath, renderProjectGitignore(), force);
  return {
    guidePath,
    workspacePath,
    gitignorePath,
  };
}

function initializeProjectGit(projectDir, force) {
  const gitDir = path.join(projectDir, '.git');
  if (fs.existsSync(gitDir)) {
    return { initialized: false, skipped: true, reason: 'git repository exists' };
  }
  runCommand('git', ['init'], { cwd: projectDir, quiet: true });
  runCommand('git', ['config', 'user.email', 'sk@example.test'], { cwd: projectDir, quiet: true });
  runCommand('git', ['config', 'user.name', 'SK Engine'], { cwd: projectDir, quiet: true });
  runCommand('git', ['add', '.'], { cwd: projectDir, quiet: true });
  const status = runCommand('git', ['status', '--short'], { cwd: projectDir, quiet: true });
  if (!status.stdout.trim()) {
    return { initialized: true, committed: false, reason: 'nothing to commit' };
  }
  runCommand('git', ['commit', '-m', 'chore: initialize sk project'], { cwd: projectDir, quiet: true });
  return { initialized: true, committed: true };
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
  const projectGit = initializeProjectGit(path.dirname(out), options.force);
  console.log(JSON.stringify({
    ...projectSummary,
    projectDir: path.dirname(out),
    conventionFiles,
    projectGit,
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
