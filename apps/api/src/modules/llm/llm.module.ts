import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmConfigService } from './llm-config.service';
import { LlmModelListService } from './llm-model-list.service';
import { LlmCredentialsCryptoService } from './llm-credentials-crypto.service';

@Module({
  providers: [LlmService, LlmConfigService, LlmModelListService, LlmCredentialsCryptoService],
  exports: [LlmService, LlmConfigService, LlmModelListService, LlmCredentialsCryptoService],
})
export class LlmModule implements OnModuleInit {
  private readonly logger = new Logger(LlmModule.name);

  constructor(private readonly llmConfig: LlmConfigService) {}

  async onModuleInit() {
    const caps = await this.llmConfig.getCapabilities();
    const configured = Object.entries(caps.providers)
      .filter(([, provider]) => provider.configured)
      .map(([id]) => id);
    this.logger.log(
      `LLM providers configured from env or defaults: ${configured.length ? configured.join(', ') : 'none'}`,
    );
    if (configured.length === 0) {
      this.logger.warn('No LLM API keys configured — set at least one key in .env (see README).');
    }
  }
}
