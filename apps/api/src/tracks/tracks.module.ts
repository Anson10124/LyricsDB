import { Module } from "@nestjs/common";
import { ResolverModule } from "../resolver/resolver.module";
import { ActivityModule } from "../activity/activity.module";
import { TurnstileModule } from "../turnstile/turnstile.module";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";
import { TrackEditService } from "./track-edit.service";
import { PlatformSearchService } from "./platform-search.service";

@Module({
  imports: [ResolverModule, ActivityModule, TurnstileModule],
  controllers: [TracksController],
  providers: [TracksService, TrackEditService, PlatformSearchService],
  exports: [TracksService],
})
export class TracksModule {}
