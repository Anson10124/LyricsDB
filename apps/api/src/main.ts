import { existsSync } from "fs";
import * as path from "path";
import { config } from "dotenv";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as fs from "fs";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

// Load .env from root if not already loaded into process.env
if (!process.env.DATABASE_URL) {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), "../.env"),
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      config({ path: envPath });
      break;
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  // Security Hardening: Disable X-Powered-By header to prevent technology fingerprinting
  expressApp.disable("x-powered-by");

  // Security Hardening: Apply essential HTTP security headers
  expressApp.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }
    next();
  });

  // CORS Configuration: Restrict allowed origins in production
  const corsOriginsEnv = process.env.CORS_ORIGINS;
  const allowedOrigins: (string | RegExp)[] | boolean =
    corsOriginsEnv && corsOriginsEnv !== "*"
      ? corsOriginsEnv.split(",").map((origin) => origin.trim())
      : process.env.NODE_ENV === "production"
        ? [
            process.env.PUBLIC_URL || "",
            process.env.SERVICE_URL_WEB || "",
            "http://localhost:3000",
          ].filter(Boolean)
        : true; // In development, allow all origins

  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    maxAge: 86400,
  });

  // Trust proxy configuration: defaults to single trusted reverse proxy hop in production
  const trustProxyConfig = process.env.TRUST_PROXY || (process.env.NODE_ENV === "production" ? 1 : "loopback");
  const parsedTrustProxy =
    trustProxyConfig === "true"
      ? true
      : trustProxyConfig === "false"
        ? false
        : !isNaN(Number(trustProxyConfig))
          ? Number(trustProxyConfig)
          : trustProxyConfig;
  expressApp.set("trust proxy", parsedTrustProxy);

  // Global Inbound Request Validation Pipeline
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filter for clean error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT || 4000;
  const publicUrl =
    process.env.PUBLIC_URL ||
    process.env.SERVICE_URL_API ||
    process.env.SERVICE_URL_WEB;

  const docBuilder = new DocumentBuilder()
    .setTitle("LyricsDB API")
    .setDescription(
      `LyricsDB is a high-performance open-source lyrics indexing and synchronization platform.\n\n` +
        `### Features\n` +
        `* **Multi-Platform Resolution**: Cross-references Spotify, Apple Music, Deezer, NetEase Cloud Music, QQ Music, and ISRC.\n` +
        `* **Precision Timed Lyrics**: Word-by-word and syllable-level sync with background vocals and duet roles.\n` +
        `* **Format Engine**: Real-time conversion to TTML, LRC, LRCA2, YRC, QRC, ESLRC, ASS, LYL, LYS, LQE, and compact JSON.\n` +
        `* **Real-Time Streaming**: Server-Sent Events (SSE) tracking extraction lifecycle and timing progress.\n` +
        `* **PostgreSQL Fast Cache**: Sub-millisecond indexed read-through caching with thundering-herd deduplication.\n` +
        `* **Provider Rate-Limiting & Circuit Breakers**: Smart queueing, RPM limits, and automated cooldowns to protect upstream services.`,
    )
    .setVersion("1.0.0")
    .setContact(
      "LyricsDB Support",
      "https://github.com/Anson10124/LyricsDB",
      "support@lyricsdb.org",
    )
    .setLicense("MIT", "https://opensource.org/licenses/MIT")
    .setExternalDoc("LyricsDB Full Documentation", "/docs")
    .addServer("/", "Current Host / Reverse Proxy (Auto-detected)")
    .addServer(`http://localhost:${port}`, "Local Development Server");

  if (publicUrl) {
    docBuilder.addServer(publicUrl.replace(/\/$/, ""), "Configured Public URL");
  }

  docBuilder
    .addTag(
      "Tracks",
      "Track lookup, database synchronization, and search operations",
    )
    .addTag(
      "Lyrics",
      "Synchronized multi-format lyrics extraction and real-time SSE streaming",
    )
    .addTag("Resolver", "Cross-platform track link resolution and matching")
    .addTag(
      "Activity",
      "Real-time SSE event streaming and monitoring for track requests and database activity",
    )
    .addTag(
      "System",
      "Server health, provider circuit breakers, and rate limit status endpoints",
    );

  const config = docBuilder.build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);
  SwaggerModule.setup("docs", app, document);

  // Write openapi.json to apps/web/openapi.json in development
  try {
    const webDir = path.resolve(__dirname, "../../web");
    if (fs.existsSync(webDir)) {
      const outputPath = path.join(webDir, "openapi.json");
      fs.writeFileSync(outputPath, JSON.stringify(document, null, 2));
      console.log(`[Swagger] Exported openapi.json to ${outputPath}`);
    }
  } catch (err) {
    console.warn("[Swagger] Could not write openapi.json to apps/web:", err);
  }

  await app.listen(port);
  console.log(`LyricsDB API running on http://localhost:${port}`);
}

bootstrap();
