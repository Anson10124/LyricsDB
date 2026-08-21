import { Module } from "@nestjs/common";
import { ResolverModule } from "../resolver/resolver.module";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";

@Module({
  imports: [ResolverModule],
  controllers: [TracksController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}
