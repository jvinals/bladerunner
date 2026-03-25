import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/** Per-user encrypted blob for LLM API keys / base URLs (JSON before encrypt). */
@Injectable()
export class LlmCredentialsCryptoService {
  private readonly logger = new Logger(LlmCredentialsCryptoService.name);

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const raw = this.config.get<string>('LLM_CREDENTIALS_ENCRYPTION_KEY')?.trim();
    if (!raw) {
      throw new Error(
        'LLM_CREDENTIALS_ENCRYPTION_KEY is not set — generate 32 bytes: openssl rand -base64 32',
      );
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== KEY_LEN) {
      throw new Error(`LLM_CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_LEN} bytes (got ${buf.length})`);
    }
    return buf;
  }

  isConfigured(): boolean {
    try {
      const raw = this.config.get<string>('LLM_CREDENTIALS_ENCRYPTION_KEY')?.trim();
      if (!raw) return false;
      const buf = Buffer.from(raw, 'base64');
      return buf.length === KEY_LEN;
    } catch {
      return false;
    }
  }

  encryptJson(obj: unknown): Uint8Array {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key(), iv);
    const pt = Buffer.from(JSON.stringify(obj), 'utf8');
    const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([iv, tag, enc]);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }

  decryptJson(buf: Uint8Array): unknown {
    if (buf.length < IV_LEN + TAG_LEN + 1) {
      throw new Error('Invalid encrypted payload length');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  }

  tryDecryptJson(buf: Uint8Array | null | undefined): Record<string, unknown> | null {
    if (!buf || buf.length === 0) return null;
    try {
      const v = this.decryptJson(buf);
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch (e) {
      this.logger.warn(`Credential decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
