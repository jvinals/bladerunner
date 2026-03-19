import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyRailwayPostgresUrlDefaults } from '../../railway-database-url';

/**
 * No eager `$connect()` in onModuleInit: Prisma connects on first query.
 * Railway URL defaults run in the constructor after ConfigModule has loaded .env.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    applyRailwayPostgresUrlDefaults();
    super();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
