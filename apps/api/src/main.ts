import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const port = process.env.PORT || 4000;
  const publicUrl =
    process.env.PUBLIC_URL ||
    process.env.SERVICE_URL_API ||
    process.env.SERVICE_URL_WEB;

  const docBuilder = new DocumentBuilder()
    .setTitle('LyricsDB API')
    .setDescription(
      `LyricsDB is a high-performance open-source lyrics indexing and synchronization platform.\n\n` +
      `### Features\n` +
      `* **Multi-Platform Resolution**: Cross-references Spotify, Apple Music, Deezer, NetEase Cloud Music, QQ Music, and ISRC.\n` +
      `* **Precision Timed Lyrics**: Word-by-word and syllable-level sync with background vocals and duet roles.\n` +
      `* **Format Engine**: Real-time conversion to TTML, LRC, LRCA2, YRC, QRC, ESLRC, ASS, LYL, LYS, LQE, and compact JSON.\n` +
      `* **Real-Time Streaming**: Server-Sent Events (SSE) tracking extraction lifecycle and timing progress.\n` +
      `* **PostgreSQL Fast Cache**: Sub-millisecond indexed read-through caching with thundering-herd deduplication.`
    )
    .setVersion('1.0.0')
    .setContact('LyricsDB Support', 'https://github.com/Anson10124/LyricsDB', 'support@lyricsdb.org')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .setExternalDoc('LyricsDB Full Documentation', '/docs')
    .addServer('/', 'Current Host / Reverse Proxy (Auto-detected)')
    .addServer(`http://localhost:${port}`, 'Local Development Server');

  if (publicUrl) {
    docBuilder.addServer(publicUrl.replace(/\/$/, ''), 'Configured Public URL');
  }

  docBuilder
    .addTag('Tracks', 'Track lookup, database synchronization, and search operations')
    .addTag('Lyrics', 'Synchronized multi-format lyrics extraction and real-time SSE streaming')
    .addTag('Resolver', 'Cross-platform track link resolution and matching')
    .addTag('System', 'Server health and system status endpoints');

  const config = docBuilder.build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Write openapi.json to apps/web/openapi.json in development
  try {
    const webDir = path.resolve(__dirname, '../../web');
    if (fs.existsSync(webDir)) {
      const outputPath = path.join(webDir, 'openapi.json');
      fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
      console.log(`[Swagger] Exported openapi.json to ${outputPath}`);
    }
  } catch (err) {
    console.warn('[Swagger] Could not write openapi.json to apps/web:', err);
  }

  await app.listen(port);
  console.log(`LyricsDB API running on http://localhost:${port}`);
}

bootstrap();
