import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyRailwayPostgresUrlDefaults } from '../../railway-database-url';

/**
 * No eager `$connect()` in onModuleInit: Prisma connects on first query.
 * Railway SSL patch runs in the constructor after ConfigModule has loaded .env.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    applyRailwayPostgresUrlDefaults();
    if (process.env.NODE_ENV !== 'production') {
      try {
        const raw = process.env.DATABASE_URL ?? '';
        const normalized = raw.replace(/^postgresql(\+\w+)?:/i, 'http:');
        const host = new URL(normalized).hostname;
        const ssl = /sslmode=/i.test(raw);
        // eslint-disable-next-line no-console
        console.log(
          `[PrismaService] DATABASE_URL host=${host} hasSslModeParam=${ssl}`,
        );
      } catch {
        /* ignore */
      }
    }
    super();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
