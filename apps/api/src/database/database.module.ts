import { Global, Module } from '@nestjs/common';
import { createDatabaseClient, DatabaseClient } from '@repo/database';
import { DATABASE_CONNECTION } from './database.constants';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: (): DatabaseClient => {
        return createDatabaseClient(process.env.DATABASE_URL);
      },
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
