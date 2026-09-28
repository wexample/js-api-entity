#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(binDir, 'template', 'Repository.ts.tpl');

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const dataDir = resolve(cwd, args['data-dir'] ?? 'front/data/entity');
const outputDir = resolve(cwd, args['output-dir'] ?? 'front/js');
const repositoryDir = path.join(outputDir, 'Repository');
const commonDir = path.join(outputDir, 'Common');

if (!fs.existsSync(dataDir)) {
  console.error(`Error: missing data directory: ${dataDir}`);
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error(`Error: missing template: ${templatePath}`);
  process.exit(1);
}

fs.mkdirSync(repositoryDir, { recursive: true });
fs.mkdirSync(commonDir, { recursive: true });

const template = fs.readFileSync(templatePath, 'utf8');
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();

let created = 0;
let skipped = 0;
const packageEntries = [];

for (const fileName of files) {
  const entityName = path.basename(fileName, '.json');
  const className = toPascalCase(entityName);
  if (!className) { skipped++; continue; }

  const entityData = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), 'utf8'));
  if (entityData.package) {
    packageEntries.push({ className, packageName: entityData.package });
    skipped++;
    console.log(`Skipped ${className}Repository (provided by package: ${entityData.package})`);
    continue;
  }

  const targetPath = path.join(repositoryDir, `${className}Repository.ts`);
  if (fs.existsSync(targetPath)) { skipped++; continue; }

  const content = template.replaceAll('{{CLASS_NAME}}', className);
  fs.writeFileSync(targetPath, content, 'utf8');
  created++;
  console.log(`Created ${targetPath}`);
}

const packageClassNames = new Set(packageEntries.map(({ className }) => `${className}Repository`));
const localRepositoryClasses = fs.readdirSync(repositoryDir)
  .filter((f) => f.endsWith('Repository.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((c) => !packageClassNames.has(c));

const manifestPath = path.join(commonDir, 'generatedRepositories.ts');
fs.writeFileSync(manifestPath, buildManifest(localRepositoryClasses, packageEntries), 'utf8');
console.log(`Updated ${manifestPath}`);
console.log(`Done: created=${created}, skipped=${skipped}`);

function buildManifest(localClasses, packageEntries) {
  const sortedLocal = [...new Set(localClasses)].sort();
  const sortedPackage = [...packageEntries].sort((a, b) => a.className.localeCompare(b.className));

  const localImports = sortedLocal
    .map((c) => `import ${c} from '../Repository/${c}.js';`)
    .join('\n');
  const packageImports = sortedPackage
    .map(({ className, packageName }) => `import ${className}Repository from '${packageName}/Repository/${className}Repository';`)
    .join('\n');

  const imports = [localImports, packageImports].filter(Boolean).join('\n');
  const allNames = [
    ...sortedLocal,
    ...sortedPackage.map(({ className }) => `${className}Repository`),
  ].sort();

  return `${imports}\n\nconst generatedRepositories = [${allNames.join(', ')}];\n\nexport default generatedRepositories;\n`;
}

function toPascalCase(value) {
  return value.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function resolve(base, p) {
  return path.isAbsolute(p) ? p : path.join(base, p);
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}
