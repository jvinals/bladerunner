import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmConfigService } from './llm-config.service';

@Module({
  providers: [LlmService, LlmConfigService],
  exports: [LlmService, LlmConfigService],
})
export class LlmModule implements OnModuleInit {
  private readonly logger = new Logger(LlmModule.name);

  constructor(private readonly llmConfig: LlmConfigService) {}

  onModuleInit() {
    const caps = this.llmConfig.getCapabilities();
    this.logger.log(
      `LLM API keys present: gemini=${caps.hasGeminiKey} openai=${caps.hasOpenAiKey} anthropic=${caps.hasAnthropicKey} openrouter=${caps.hasOpenRouterKey}`,
    );
    if (!caps.hasGeminiKey && !caps.hasOpenAiKey && !caps.hasAnthropicKey && !caps.hasOpenRouterKey) {
      this.logger.warn('No LLM API keys configured — set at least one key in .env (see README).');
    }
  }
}
