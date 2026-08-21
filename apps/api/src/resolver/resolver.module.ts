import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ResolverController } from "./resolver.controller";
import { ResolverService } from "./resolver.service";

@Module({
  imports: [DatabaseModule],
  controllers: [ResolverController],
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
