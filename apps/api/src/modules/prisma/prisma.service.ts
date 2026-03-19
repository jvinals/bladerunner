import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * No eager `$connect()` in onModuleInit: Prisma connects on first query.
 * That way a bad DATABASE_URL (e.g. unreachable Railway host) does not crash
 * bootstrap before `listen()` — `/health` can still report DB status and the
 * process stays up for local dev.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
