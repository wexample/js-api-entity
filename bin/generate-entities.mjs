#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(binDir, 'template', 'Entity.ts.tpl');

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const dataDir = resolve(cwd, args['data-dir'] ?? 'front/data/entity');
const outputDir = resolve(cwd, args['output-dir'] ?? 'front/js');
const entityDir = path.join(outputDir, 'Entity');
const commonDir = path.join(outputDir, 'Common');

if (!fs.existsSync(dataDir)) {
  console.error(`Error: missing data directory: ${dataDir}`);
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error(`Error: missing template: ${templatePath}`);
  process.exit(1);
}

fs.mkdirSync(entityDir, { recursive: true });
fs.mkdirSync(commonDir, { recursive: true });

const template = fs.readFileSync(templatePath, 'utf8');
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();

let created = 0;
let skipped = 0;

for (const fileName of files) {
  const entityName = path.basename(fileName, '.json');
  const className = toPascalCase(entityName);
  if (!className) { skipped++; continue; }

  const entityData = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), 'utf8'));
  if (entityData.package) {
    skipped++;
    console.log(`Skipped ${className} (provided by package: ${entityData.package})`);
    continue;
  }

  const targetPath = path.join(entityDir, `${className}.ts`);
  if (fs.existsSync(targetPath)) { skipped++; continue; }

  const relativeDataDir = path.relative(entityDir, dataDir).replaceAll(path.sep, '/');
  const content = template
    .replaceAll('{{CLASS_NAME}}', className)
    .replaceAll('{{CAMEL_NAME}}', toCamelCase(entityName))
    .replaceAll('{{ENTITY_NAME}}', entityName)
    .replaceAll('{{DATA_DIR}}', relativeDataDir);

  fs.writeFileSync(targetPath, content, 'utf8');
  created++;
  console.log(`Created ${targetPath}`);
}

const manifestPath = path.join(commonDir, 'generatedEntitySchemas.ts');
fs.writeFileSync(manifestPath, buildSchemasManifest(files), 'utf8');
console.log(`Updated ${manifestPath}`);
console.log(`Done: created=${created}, skipped=${skipped}`);

function buildSchemasManifest(jsonFiles) {
  const sorted = [...jsonFiles].sort();
  const relativeDataDir = path.relative(commonDir, dataDir).replaceAll(path.sep, '/');
  const imports = sorted
    .map((f) => {
      const base = path.basename(f, '.json');
      return `import ${toCamelCase(base)} from '${relativeDataDir}/${base}.json';`;
    })
    .join('\n');
  const entries = sorted
    .map((f) => {
      const v = toCamelCase(path.basename(f, '.json'));
      return `    [${v}.name]: ${v},`;
    })
    .join('\n');

  return `${imports}\n\ntype EntitySchema = { name: string };\n\nexport default function getGeneratedEntitySchemas(): Record<string, EntitySchema> {\n  return {\n${entries}\n  };\n}\n`;
}

function toPascalCase(value) {
  return value.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function toCamelCase(value) {
  const p = toPascalCase(value);
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : '';
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
