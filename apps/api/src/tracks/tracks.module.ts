import { Module } from "@nestjs/common";
import { ResolverModule } from "../resolver/resolver.module";
import { ActivityModule } from "../activity/activity.module";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";

@Module({
  imports: [ResolverModule, ActivityModule],
  controllers: [TracksController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}
