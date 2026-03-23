import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { OpenAiProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule implements OnModuleInit {
  private readonly logger = new Logger(LlmModule.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
  ) {}

  onModuleInit() {
    const provider = this.configService.get<string>('LLM_PROVIDER', 'openai');

    switch (provider) {
      case 'openai': {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        const model = this.configService.get<string>('OPENAI_MODEL', 'gpt-5.4-mini');
        if (apiKey) {
          this.llmService.setProvider(new OpenAiProvider(apiKey, model));
          this.logger.log(`LLM provider: OpenAI (${model})`);
        } else {
          this.logger.warn('OPENAI_API_KEY not set — LLM features will use fallback mode');
        }
        break;
      }
      case 'anthropic': {
        const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
        const model = this.configService.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514');
        if (apiKey) {
          this.llmService.setProvider(new AnthropicProvider(apiKey, model));
          this.logger.log(`LLM provider: Anthropic (${model})`);
        } else {
          this.logger.warn('ANTHROPIC_API_KEY not set — LLM features will use fallback mode');
        }
        break;
      }
      default:
        this.logger.warn(`Unknown LLM_PROVIDER "${provider}" — LLM features disabled`);
    }

    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    const geminiModel =
      this.configService.get<string>('GEMINI_INSTRUCTION_MODEL')?.trim() || 'gemini-3-flash-preview';
    if (geminiKey?.trim()) {
      this.logger.log(`Gemini Playwright instruction path: enabled (GEMINI_INSTRUCTION_MODEL=${geminiModel})`);
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not set — instructionToAction (AI prompt / instruct Playwright codegen) will fail until it is set',
      );
    }
  }
}
