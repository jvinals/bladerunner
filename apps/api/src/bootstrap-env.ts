import { appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const DEBUG_LOG = '/Users/jvinals/code/bladerunner/.cursor/debug-5cf234.log';

function debugLog(location: string, message: string, data: Record<string, unknown>) {
  try {
    appendFileSync(
      DEBUG_LOG,
      JSON.stringify({
        sessionId: '5cf234',
        location,
        message,
        data: { ...data, hypothesisId: 'H-env-override' },
        timestamp: Date.now(),
      }) + '\n',
    );
  } catch {
    // ignore
  }
}

// Nest @nestjs/config assigns dotenv values only for keys not already in process.env.
// An empty GEMINI_API_KEY from the parent shell would block values from .env — preload with override.
// Load order: monorepo root first, then apps/api (last wins). Do not append resolve(cwd, '.env') — when
// cwd is the repo root it would overwrite apps/api/.env after we applied it.
debugLog('bootstrap-env.ts:pre', 'GEMINI before dotenv preload', {
  hasKey: Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_API_KEY'),
  lenPre: process.env.GEMINI_API_KEY?.length ?? 0,
  cwd: process.cwd(),
});

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

debugLog('bootstrap-env.ts:post', 'GEMINI after dotenv preload', {
  hasKey: Object.prototype.hasOwnProperty.call(process.env, 'GEMINI_API_KEY'),
  lenPost: process.env.GEMINI_API_KEY?.length ?? 0,
});
