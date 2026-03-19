import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyRailwaySslToDatabaseUrl } from '../../railway-database-url';

/**
 * No eager `$connect()` in onModuleInit: Prisma connects on first query.
 * Railway SSL patch runs in the constructor after ConfigModule has loaded .env.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    applyRailwaySslToDatabaseUrl();
    super();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
