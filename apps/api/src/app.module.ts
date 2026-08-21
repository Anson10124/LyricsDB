import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./database/database.module";
import { ResolverModule } from "./resolver/resolver.module";
import { StorageModule } from "./storage/storage.module";
import { TracksModule } from "./tracks/tracks.module";

@Module({
  imports: [DatabaseModule, ResolverModule, StorageModule, TracksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
