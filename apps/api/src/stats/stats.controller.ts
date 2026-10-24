import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LibraryStatsResponseDto } from "./dto/stats-response.dto";
import { StatsService } from "./stats.service";

@ApiTags("Stats")
@Controller(["api/stats", "stats"])
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @ApiOperation({
    summary: "Get cached library statistics",
    description:
      "Returns aggregate counts over the cached track library: lyrics sync types (word, line, plain, none), per-provider breakdown, translation and romaji coverage, platform ID coverage, and tracks added per day over the last 30 days. Results are cached for up to 60 seconds.",
  })
  @ApiOkResponse({
    type: LibraryStatsResponseDto,
    description: "Aggregate library statistics",
  })
  @Get()
  getStats(): Promise<LibraryStatsResponseDto> {
    return this.statsService.getStats();
  }
}
