import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ResolverModule } from './resolver/resolver.module';

@Module({
  imports: [ResolverModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
