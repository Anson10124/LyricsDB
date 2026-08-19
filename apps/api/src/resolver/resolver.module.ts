import { Module } from '@nestjs/common';
import { ResolverController } from './resolver.controller';
import { ResolverService } from './resolver.service';

@Module({
  controllers: [ResolverController],
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
