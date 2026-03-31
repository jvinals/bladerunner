import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { parse } from 'pg-connection-string';
import type { PoolConfig } from 'pg';
import { applyRailwayPostgresUrlDefaults } from '../../railway-database-url';

/**
 * No eager `$connect()` in onModuleInit: Prisma connects on first query.
 * Railway URL defaults run in the constructor after ConfigModule has loaded .env.
 *
 * **TLS / self-signed hosts:** `pg` merges `parse(connectionString)` *after* top-level keys
 * (`Object.assign({}, config, parse(connectionString))` in ConnectionParameters). Query params
 * like `sslmode=require` produce `ssl: {}`, which **overwrites** a sibling
 * `ssl: { rejectUnauthorized: false }` and triggers strict chain verification. We therefore build a
 * discrete `PoolConfig` from `parse(DATABASE_URL)` and merge `rejectUnauthorized: false` onto
 * `ssl` instead of passing `{ connectionString, ssl }` together.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    applyRailwayPostgresUrlDefaults();
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      throw new Error('DATABASE_URL is required');
    }
    const parsed = parse(raw);
    const poolConfig = buildPoolConfigWithRelaxedTls(parsed);

    const adapter = new PrismaPg(poolConfig);
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Preserve Railway / cloud TLS while allowing self-signed or proxy chains (matches prior intent). */
function buildPoolConfigWithRelaxedTls(parsed: ReturnType<typeof parse>): PoolConfig {
  const poolConfig = { ...parsed } as PoolConfig;
  if (poolConfig.ssl !== false && poolConfig.ssl !== undefined) {
    poolConfig.ssl = {
      rejectUnauthorized: false,
      ...(typeof poolConfig.ssl === 'object' && poolConfig.ssl !== null ? poolConfig.ssl : {}),
    };
  }
  return poolConfig;
}
