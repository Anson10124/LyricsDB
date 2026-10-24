import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";

@Module({
  imports: [DatabaseModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
