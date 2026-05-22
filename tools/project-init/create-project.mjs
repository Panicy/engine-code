#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/validate-feature.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

function usage() {
  return [
    '用法：node tools/project-init/create-project.mjs \\',
    '  --project-id <project-id> \\',
    '  --name <项目名称> \\',
    '  --base baseId:templateId:repo:workspace \\',
    '  --out <project.json>',
    '',
    '可选：',
    '  --description <项目说明>',
    '  --base 可重复传入多个',
    '  --force',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { base: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    if (key === 'base') args.base.push(value);
    else args[key] = value;
    i += 1;
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) throw new Error(`缺少必填参数 --${key}`);
}

function assertValidUri(value) {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol) throw new Error('missing protocol');
  } catch {
    throw new Error(`repo 不是合法 URI：${value}`);
  }
}

function assertTemplateExists(templateId) {
  const templatePath = path.resolve(repoRoot, '.engine/templates', templateId, 'template.json');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`templateId 不存在：${templateId}`);
  }
}

function assertWorkspaceExists(workspace) {
  const workspacePath = path.resolve(repoRoot, workspace);
  if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
    throw new Error(`workspace 不存在：${workspace}`);
  }
}

function parseBase(value) {
  const parts = value.split(':');
  if (parts.length < 4) {
    throw new Error(`--base 格式应为 baseId:templateId:repo:workspace：${value}`);
  }
  const [baseId, templateId, ...rest] = parts;
  const workspace = rest.pop();
  const repo = rest.join(':');
  if (!baseId || !templateId || !repo || !workspace) {
    throw new Error(`--base 格式应为 baseId:templateId:repo:workspace：${value}`);
  }
  assertValidUri(repo);
  assertTemplateExists(templateId);
  assertWorkspaceExists(workspace);
  return {
    baseId,
    templateId,
    repo,
    workspace,
    branch: '',
    overrides: {
      allowedPaths: [],
      devCommands: [],
      checks: [],
    },
  };
}

function readProjectSchema() {
  const schemaPath = path.resolve(repoRoot, 'schemas/project.schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function buildProject(args) {
  requireArg(args, 'project-id');
  requireArg(args, 'name');
  requireArg(args, 'out');
  if (args.base.length === 0) throw new Error('至少需要一个 --base');

  const bases = args.base.map(parseBase);
  const seenBaseIds = new Set();
  const duplicatedBaseIds = [];
  for (const base of bases) {
    if (seenBaseIds.has(base.baseId)) duplicatedBaseIds.push(base.baseId);
    seenBaseIds.add(base.baseId);
  }
  if (duplicatedBaseIds.length > 0) {
    throw new Error(`baseId 不能重复：${[...new Set(duplicatedBaseIds)].join(', ')}`);
  }

  return {
    schemaVersion: '0.1.0',
    projectId: args['project-id'],
    name: args.name,
    description: args.description ?? '',
    status: 'active',
    bases,
  };
}

function writeProject(filePath, project, force) {
  const abs = path.resolve(repoRoot, filePath);
  if (fs.existsSync(abs) && force !== true) {
    throw new Error(`目标文件已存在，拒绝覆盖：${abs}。如确认覆盖，请使用 --force。`);
  }
  const schema = readProjectSchema();
  const errors = validateSchema(project, schema, { file: filePath, rootSchema: schema });
  if (errors.length > 0) {
    throw new Error(`project 不符合 project.schema.json：\n${JSON.stringify(errors, null, 2)}`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return abs;
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      console.log(usage());
      return;
    }
    const project = buildProject(args);
    const outputPath = writeProject(args.out, project, args.force);
    console.log(JSON.stringify({
      ok: true,
      outputPath,
      projectId: project.projectId,
      baseCount: project.bases.length,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  main();
}

export { buildProject };
