import 'reflect-metadata';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../apps/api/src/modules/prisma/prisma.service';
import { LlmCredentialsCryptoService } from '../apps/api/src/modules/llm/llm-credentials-crypto.service';
import { LlmConfigService } from '../apps/api/src/modules/llm/llm-config.service';
import { LlmModelListService } from '../apps/api/src/modules/llm/llm-model-list.service';
import { SettingsService } from '../apps/api/src/modules/settings/settings.service';

async function main() {
  dotenv.config({ path: join(__dirname, '..', '.env') });
  dotenv.config({ path: join(__dirname, '..', 'apps', 'api', '.env'), override: true });
  const config = new ConfigService(process.env);
  const prisma = new PrismaService();
  const crypto = new LlmCredentialsCryptoService(config);
  const llmConfig = new LlmConfigService(config, prisma, crypto);
  const llmModelList = new LlmModelListService(config, llmConfig);
  const settings = new SettingsService(prisma, llmConfig, llmModelList);
  try {
    const userId = 'debug-llm-save-user';
    const current = (await settings.getSettings(userId)) as {
      llm?: {
        usage?: Record<string, { provider: string; model: string }>;
        providerCredentials?: Record<string, { apiKeyMasked?: string; baseUrl?: string }>;
      };
    };
    const providerCredentials = Object.fromEntries(
      Object.entries(current.llm?.providerCredentials ?? {}).map(([providerId, cred]) => [
        providerId,
        {
          baseUrl: cred.baseUrl ?? '',
        },
      ]),
    );
    await settings.updateSettings(userId, {
      llm: {
        usage: current.llm?.usage ?? {},
        providerCredentials,
      },
    });
    console.log('repro-success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`repro-error: ${message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
