import { Module } from "@nestjs/common";
import { TracksModule } from "../tracks/tracks.module";
import { MatchController } from "./match.controller";
import { defaultMatchSources, MATCH_SOURCES, MatchService } from "./match.service";

@Module({
  imports: [TracksModule],
  controllers: [MatchController],
  providers: [MatchService, { provide: MATCH_SOURCES, useValue: defaultMatchSources }],
})
export class MatchModule {}
