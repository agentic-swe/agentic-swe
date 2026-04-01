#!/usr/bin/env node
/**
 * Installs Agentic SWE into a target project from the published npm package.
 * End users should use this CLI (or npx); do not direct them to clone a repo to install.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const DELIMITER =
  '<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->';
const SUBDIRS = ['commands', 'phases', 'agents', 'templates', 'references', 'tools'];

function pkgRoot() {
  return path.join(__dirname, '..');
}

function parseArgs(argv) {
  const args = { help: false, yes: false, target: null };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-y' || a === '--yes') args.yes = true;
    else if (!a.startsWith('-')) rest.push(a);
  }
  if (rest[0] === 'install' && rest[1]) args.target = path.resolve(rest[1]);
  else if (rest[0] === 'install' && !rest[1]) args.target = process.cwd();
  else if (rest[0] && rest[0] !== 'install') args.target = path.resolve(rest[0]);
  else if (!rest.length) args.target = process.cwd();
  return args;
}

function printHelp() {
  console.log(`Usage:
  agentic-swe [options] [path]
  agentic-swe install [path]

  Install the Agentic SWE pipeline into a project directory (default: current directory).

Options:
  -y, --yes   Skip the prompt when the target is not a git repository
  -h, --help  Show this help
`);
}

function isGitRepo(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return r.status === 0;
}

function stripTrailingBlankAndRule(content) {
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length && lines[lines.length - 1].trim() === '---') lines.pop();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

function countSubagentMd(dir) {
  let n = 0;
  const subagents = path.join(dir, 'agents', 'subagents');
  if (!fs.existsSync(subagents)) return 0;
  function walk(d) {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.isFile() && name.name.endsWith('.md')) n++;
    }
  }
  walk(subagents);
  return n;
}

function countGlob(dir, pattern) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

async function confirmNonGit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Continue anyway? [y/N] ', (answer) => {
      rl.close();
      resolve(/^y$/i.test(answer.trim()));
    });
  });
}

function appendGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const line = '.claude/.work/';
  if (fs.existsSync(gitignorePath)) {
    const body = fs.readFileSync(gitignorePath, 'utf8');
    if (!body.split(/\r?\n/).includes(line)) {
      fs.appendFileSync(gitignorePath, (body.endsWith('\n') ? '' : '\n') + line + '\n');
      console.log('Added .claude/.work/ to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, line + '\n');
    console.log('Created .gitignore with .claude/.work/');
  }
}

function install() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const root = pkgRoot();
  const sourceClaude = path.join(root, '.claude');
  const sourceClaudeMd = path.join(root, 'CLAUDE.md');
  const targetDir = path.resolve(args.target || process.cwd());

  if (!fs.existsSync(path.join(sourceClaude, 'phases')) || !fs.existsSync(path.join(sourceClaude, 'commands'))) {
    console.error(
      'ERROR: Could not find .claude/phases/ or .claude/commands/ next to this CLI.\n' +
        '       Reinstall the agentic-swe package or run from a full clone.'
    );
    process.exit(1);
  }

  if (!fs.existsSync(sourceClaudeMd)) {
    console.error('ERROR: CLAUDE.md missing from package root.');
    process.exit(1);
  }

  if (path.resolve(root) === targetDir) {
    console.error(
      'ERROR: Target is the same as the agentic-swe package root.\n' +
        '       Point at your project directory, e.g. agentic-swe /path/to/your/project'
    );
    process.exit(1);
  }

  if (!fs.existsSync(targetDir)) {
    console.error(`ERROR: Directory does not exist: ${targetDir}`);
    process.exit(1);
  }

  (async () => {
    if (!isGitRepo(targetDir)) {
      console.warn(`WARNING: ${targetDir} is not a git repository.`);
      if (!args.yes) {
        const ok = await confirmNonGit();
        if (!ok) process.exit(1);
      }
    }

    console.log('=== Agentic SWE Pipeline Installer ===\n');
    console.log(`Source:  ${sourceClaude}`);
    console.log(`Target:  ${path.join(targetDir, '.claude')}\n`);

    console.log('Copying pipeline files...');
    const targetClaude = path.join(targetDir, '.claude');
    fs.mkdirSync(targetClaude, { recursive: true });

    for (const dir of SUBDIRS) {
      const from = path.join(sourceClaude, dir);
      if (fs.existsSync(from)) {
        fs.cpSync(from, path.join(targetClaude, dir), { recursive: true });
      }
    }

    const workDir = path.join(targetClaude, '.work');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, '.gitkeep'), '');

    if (fs.existsSync(path.join(targetClaude, 'settings.local.json'))) {
      console.log('  Preserving existing settings.local.json');
    }

    const agentCount = countSubagentMd(targetClaude);

    const policyBody = fs.readFileSync(sourceClaudeMd, 'utf8');
    const targetClaudeMd = path.join(targetDir, 'CLAUDE.md');

    console.log('Setting up CLAUDE.md...');
    if (fs.existsSync(targetClaudeMd)) {
      let existing = fs.readFileSync(targetClaudeMd, 'utf8');
      if (existing.includes('BEGIN autonomous-swe-pipeline policy')) {
        console.log('  Updating existing pipeline policy...');
        const idx = existing.indexOf(DELIMITER);
        if (idx === -1) {
          console.log('  (delimiter not found; appending policy block)');
          existing =
            existing.trimEnd() +
            '\n\n---\n\n' +
            DELIMITER +
            '\n\n' +
            policyBody;
        } else {
          const before = stripTrailingBlankAndRule(existing.slice(0, idx));
          existing = before + '\n\n---\n\n' + DELIMITER + '\n\n' + policyBody;
        }
        fs.writeFileSync(targetClaudeMd, existing);
      } else {
        console.log('  Appending pipeline policy to existing CLAUDE.md...');
        fs.appendFileSync(
          targetClaudeMd,
          '\n\n---\n\n' + DELIMITER + '\n\n' + policyBody
        );
      }
    } else {
      console.log('  Creating CLAUDE.md...');
      fs.copyFileSync(sourceClaudeMd, targetClaudeMd);
    }

    appendGitignore(targetDir);

    const cmdCount = countGlob(path.join(targetClaude, 'commands'));
    const phaseCount = countGlob(path.join(targetClaude, 'phases'));
    const coreAgents = fs.existsSync(path.join(targetClaude, 'agents'))
      ? fs.readdirSync(path.join(targetClaude, 'agents')).filter(
          (f) => f.endsWith('.md') && !fs.statSync(path.join(targetClaude, 'agents', f)).isDirectory()
        ).length
      : 0;
    const panelCount = countGlob(path.join(targetClaude, 'agents', 'panel'));

    console.log('\n=== Installation complete ===\n');
    console.log(`  Commands:   ${cmdCount} slash commands`);
    console.log(`  Phases:     ${phaseCount} phase prompts`);
    console.log(`  Agents:     ${coreAgents} core + ${panelCount} panel`);
    console.log(`  Subagents:  ${agentCount} specialized subagents\n`);
    console.log('Next steps:');
    console.log(`  cd ${targetDir} && claude`);
    console.log('  /work <your task description>\n');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

install();
