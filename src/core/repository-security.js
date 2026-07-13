import { posix } from 'node:path';

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 5000,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxSkills: 100
});

const RISK_PATTERNS = [
  { code: 'REMOTE_PIPE_EXECUTION', severity: 'high', pattern: /(?:curl|wget)\b[^\r\n|]{0,500}\|\s*(?:ba)?sh\b/i, message: 'Downloads remote content and pipes it into a shell.' },
  { code: 'DYNAMIC_CODE_EXECUTION', severity: 'high', pattern: /\b(?:eval|exec|Invoke-Expression)\b/i, message: 'Contains dynamic code execution.' },
  { code: 'DESTRUCTIVE_DELETE', severity: 'high', pattern: /(?:rm\s+-[^\r\n]*r[^\r\n]*f|Remove-Item\b[^\r\n]*-Recurse[^\r\n]*-Force)/i, message: 'Contains a recursive forced deletion command.' },
  { code: 'PROCESS_EXECUTION', severity: 'medium', pattern: /(?:child_process|subprocess\.|os\.system\s*\()/i, message: 'Contains process execution code.' },
  { code: 'SECRET_ACCESS', severity: 'medium', pattern: /(?:\.env\b|API[_-]?KEY|ACCESS[_-]?TOKEN|credentials?)/i, message: 'References credentials or environment secrets.' }
];

export function normalizeRepositorySlug(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Invalid GitHub repository.');
  const value = input.trim();

  if (REPOSITORY_PATTERN.test(value) && !value.split('/').some(part => part === '.' || part === '..')) return value;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid GitHub repository.');
    }
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 2) throw new Error('Invalid GitHub repository.');
    const slug = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`.toLowerCase();
    if (!REPOSITORY_PATTERN.test(slug) || slug.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GitHub repository.');
    return slug;
  } catch (error) {
    if (String(error.message).includes('GitHub repository')) throw error;
    throw new Error('Invalid GitHub repository.');
  }
}

export function normalizeCommitSha(input) {
  if (typeof input !== 'string' || !COMMIT_PATTERN.test(input)) throw new Error('Invalid commit SHA.');
  return input.toLowerCase();
}

export function validateArchivePath(input) {
  if (typeof input !== 'string' || !input || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('Invalid archive path.');
  const normalized = input.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error('Invalid archive path.');
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid archive path.');
  const clean = posix.normalize(normalized);
  if (clean.startsWith('../') || clean === '..') throw new Error('Invalid archive path.');
  return clean;
}

function finding(code, severity, message, path = null) {
  return { code, severity, message, ...(path ? { path } : {}) };
}

export function analyzeRepositoryFiles(files, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const findings = [];
  const normalizedFiles = [];
  let totalBytes = 0;

  if (!Array.isArray(files)) throw new Error('Repository file list is required.');
  if (options.isTreeTruncated) findings.push(finding('INCOMPLETE_TREE', 'blocked', 'GitHub returned a truncated repository tree.'));
  if (files.length > limits.maxFiles) findings.push(finding('TOO_MANY_FILES', 'blocked', `Repository contains more than ${limits.maxFiles} files.`));

  const seen = new Set();
  for (const file of files.slice(0, limits.maxFiles + 1)) {
    let path;
    try { path = validateArchivePath(file?.path); }
    catch { findings.push(finding('UNSAFE_ARCHIVE_PATH', 'blocked', 'Repository contains an unsafe archive path.')); continue; }
    if (seen.has(path)) {
      findings.push(finding('DUPLICATE_ARCHIVE_PATH', 'blocked', 'Repository contains duplicate archive paths.', path));
      continue;
    }
    seen.add(path);
    const size = Number(file?.size) || 0;
    if (size < 0 || size > limits.maxFileBytes) findings.push(finding('FILE_TOO_LARGE', 'blocked', `File exceeds ${limits.maxFileBytes} bytes.`, path));
    totalBytes += Math.max(0, size);
    normalizedFiles.push({ path, size, text: typeof file?.text === 'string' ? file.text : '' });
  }

  if (totalBytes > limits.maxTotalBytes) findings.push(finding('ARCHIVE_TOO_LARGE', 'blocked', `Repository exceeds ${limits.maxTotalBytes} bytes.`));

  const skills = normalizedFiles
    .filter(file => posix.basename(file.path) === 'SKILL.md')
    .map(file => {
      const root = posix.dirname(file.path);
      return { name: root === '.' ? 'root-skill' : posix.basename(root), path: root, skillFile: file.path };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!skills.length) findings.push(finding('NO_SKILLS_FOUND', 'blocked', 'No SKILL.md files were found.'));
  if (skills.length > limits.maxSkills) findings.push(finding('TOO_MANY_SKILLS', 'blocked', `Repository contains more than ${limits.maxSkills} skills.`));

  for (const file of normalizedFiles) {
    if (!file.text) continue;
    for (const rule of RISK_PATTERNS) {
      if (rule.pattern.test(file.text)) findings.push(finding(rule.code, rule.severity, rule.message, file.path));
    }
  }

  const hasBlocked = findings.some(item => item.severity === 'blocked');
  const hasHigh = findings.some(item => item.severity === 'high');
  const hasMedium = findings.some(item => item.severity === 'medium');
  const level = hasBlocked ? 'blocked' : hasHigh ? 'high' : hasMedium ? 'medium' : 'low';

  return {
    installable: !hasBlocked,
    fileCount: normalizedFiles.length,
    totalBytes,
    skills: skills.slice(0, limits.maxSkills),
    risk: {
      level,
      requiresAcknowledgement: !hasBlocked && hasHigh,
      findings
    }
  };
}

export function normalizeSkillSelection(selected, available) {
  if (!Array.isArray(available)) throw new Error('Available skills are required.');
  const allowed = new Set(available.map(item => item.path));
  const wanted = Array.isArray(selected) && selected.length ? selected : [...allowed];
  const unique = [...new Set(wanted)];
  if (!unique.length || unique.length > DEFAULT_LIMITS.maxSkills || unique.some(path => !allowed.has(path))) {
    throw new Error('Invalid skill selection.');
  }
  return unique.sort();
}
