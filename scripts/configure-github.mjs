import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2]?.trim();
if (!input) {
  console.error('Usage: npm run configure:github -- OWNER/REPOSITORY');
  process.exit(1);
}

const normalized = input
  .replace(/^https?:\/\/github\.com\//i, '')
  .replace(/\.git$/i, '')
  .replace(/^\/+|\/+$/g, '');
const [owner, repo, ...extra] = normalized.split('/');
if (!owner || !repo || extra.length > 0) {
  console.error('Expected OWNER/REPOSITORY or a GitHub repository URL.');
  process.exit(1);
}

const demoUrl = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
  ? `https://${owner}.github.io/`
  : `https://${owner}.github.io/${repo}/`;
const repositoryUrl = `https://github.com/${owner}/${repo}`;
const readmePath = path.join(root, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme
  .replaceAll('https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/', demoUrl)
  .replaceAll('https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY', repositoryUrl)
  .replaceAll('YOUR_GITHUB_USERNAME', owner)
  .replaceAll('YOUR_REPOSITORY', repo);
fs.writeFileSync(readmePath, readme);
console.log(`README configured for ${repositoryUrl}`);
console.log(`Demo URL: ${demoUrl}`);
