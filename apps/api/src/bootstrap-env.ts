import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Nest @nestjs/config assigns dotenv values only for keys not already in process.env.
// An empty GEMINI_API_KEY from the parent shell would block values from .env — preload with override.
// Load order: monorepo root first, then apps/api (last wins). Do not append resolve(cwd, '.env') — when
// cwd is the repo root it would overwrite apps/api/.env after we applied it.
const rootEnv = join(__dirname, '..', '..', '..', '.env');
const apiEnv = join(__dirname, '..', '.env');
const apiEnvFromRepoRoot = resolve(process.cwd(), 'apps', 'api', '.env');

if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv, override: true });
}
if (existsSync(apiEnvFromRepoRoot)) {
  loadDotenv({ path: apiEnvFromRepoRoot, override: true });
}
if (existsSync(apiEnv)) {
  loadDotenv({ path: apiEnv, override: true });
}
