import { Module } from "@nestjs/common";
import { ResolverModule } from "../resolver/resolver.module";
import { ActivityModule } from "../activity/activity.module";
import { TurnstileModule } from "../turnstile/turnstile.module";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";

@Module({
  imports: [ResolverModule, ActivityModule, TurnstileModule],
  controllers: [TracksController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}
