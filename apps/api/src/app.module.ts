import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./database/database.module";
import { ResolverModule } from "./resolver/resolver.module";
import { StorageModule } from "./storage/storage.module";
import { SystemController } from "./system/system.controller";
import { TracksModule } from "./tracks/tracks.module";
import { CustomThrottlerGuard } from "./common/guards/throttler.guard";
import { RateLimiterModule } from "./common/rate-limiter/rate-limiter.module";

@Module({
  imports: [
    RateLimiterModule,
    ThrottlerModule.forRoot([
      {
        name: "short",
        ttl: 1000,
        limit: 15,
      },
      {
        name: "medium",
        ttl: 60000,
        limit: 120,
      },
    ]),
    DatabaseModule,
    ResolverModule,
    StorageModule,
    TracksModule,
  ],
  controllers: [AppController, SystemController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
