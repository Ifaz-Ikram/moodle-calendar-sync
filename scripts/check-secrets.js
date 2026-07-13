const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'node_modules']);
const allowedFiles = new Set([
  'scripts/check-secrets.js',
  'README.md',
  'script-properties.example.json',
]);

const suspiciousPatterns = [
  {
    name: 'Moodle private calendar export URL',
    pattern: /https?:\/\/[^\s"']*\/calendar\/export_execute\.php[^\s"']*(?:token|authtoken|userid|preset_what|preset_time)[^\s"']*/i,
  },
  {
    name: 'Moodle web service token assignment',
    pattern: /MOODLE_TOKEN["']?\s*[:=]\s*["'](?!MOODLE_TOKEN\b|PASTE_|<your\b|YOUR_|the_token_value\b)[^"'\s]{12,}["']/i,
  },
  {
    name: 'Moodle token query parameter',
    pattern: /[?&](?:wstoken|token|privatetoken)=[A-Za-z0-9_-]{12,}/i,
  },
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) return [];
      return walk(fullPath);
    }

    return [relativePath];
  });
}

function isTextFile(file) {
  return /\.(js|json|md|yml|yaml|gitignore|claspignore)$/i.test(file) ||
    file === '.gitignore' ||
    file === '.claspignore';
}

function checkFile(file) {
  if (!isTextFile(file)) return [];

  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return suspiciousPatterns.flatMap((rule) => {
    const matches = text.match(rule.pattern);
    if (!matches) return [];

    if (allowedFiles.has(file) && matches[0].includes('PASTE_')) {
      return [];
    }

    return [`${file}: possible ${rule.name}`];
  });
}

const findings = walk(root).flatMap(checkFile);

if (findings.length) {
  console.error('Secret check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Secret check passed.');
