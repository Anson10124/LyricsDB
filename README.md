# LyricsDB

<p align="center">
  <strong>A high-performance open-source lyrics indexing, synchronization, and multi-platform metadata resolution platform.</strong>
</p>

<p align="center">
  <a href="#key-features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#self-hosting--database-options">Self-Hosting</a> •
  <a href="#supported-formats">Formats</a> •
  <a href="#tech-stack">Architecture</a> •
  <a href="#api-reference">API</a>
</p>

---

## Key Features

- **Cross-Platform Song Matching**: Automatically cross-references song metadata across **Spotify**, **Apple Music**, **Deezer**, **NetEase Cloud Music**, **QQ Music**, and standard **ISRC** codes with confidence scoring tiers.
- **Syllable & Word-by-Word Timed Lyrics**: Extracts precise word- and syllable-level timestamps with support for background vocals and duet roles.
- **Multi-Tiered Resolution Engine**: Concurrently queries and scores lyrics candidates across upstream providers (QQ Music, Deezer, NetEase, Musixmatch, LRCLIB) with intelligent fallback from word-level sync to line-level and plain text.
- **Universal Format Engine**: Dynamically converts lyrics to **TTML**, **LRC**, **LRCA2**, **YRC**, **QRC**, **ESLRC**, **ASS**, **LYL**, **LYS**, **LQE**, and structured **JSON**.
- **Real-Time Streaming**: Server-Sent Events (SSE) tracking extraction lifecycle and timing progress (`/api/lyrics/stream`).
- **Hybrid Storage & PostgreSQL Caching**: Sub-millisecond indexed metadata caching in PostgreSQL with optional S3-compatible Object Storage offloading (**Supabase Storage**, **Cloudflare R2**, **AWS S3**, **MinIO**) to scale to **1,000,000+ tracks** on free tiers.

---

## Quick Start

### 1. Prerequisites

- **Node.js**: $\ge 18$
- **pnpm**: $\ge 9.0.0$
- **Docker** (optional, for running local PostgreSQL)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/Anson10124/LyricsDB.git
cd LyricsDB

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
```

### 3. Database Setup & Push

```bash
# Start local Docker PostgreSQL (if using local database)
pnpm db:up

# Push schema to database
pnpm db:push
```

### 4. Run Development Server

```bash
pnpm dev
```

- **Web Interface**: [http://localhost:3000](http://localhost:3000)
- **API Server**: [http://localhost:4000](http://localhost:4000)
- **Swagger Documentation**: [http://localhost:4000/docs](http://localhost:4000/docs)

---

## Self-Hosting & Database Options

LyricsDB supports multiple self-hosting architectures:

### Option A: 100% Local with Docker (Zero External Config)

```bash
docker compose up -d
```

Runs the full stack: local PostgreSQL container, NestJS API, and Next.js Web frontend.

### Option B: Supabase (500 MB DB + 1 GB Storage Free Tier)

1. Set up a project on [Supabase](https://supabase.com).
2. Create a bucket named `lyrics` in Supabase Storage.
3. Configure your `.env`:

   ```env
   # PostgreSQL Connection
   DATABASE_URL=postgres://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   DIRECT_URL=postgres://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   DATABASE_SSL=require

   # Supabase Storage (S3 Protocol)
   STORAGE_BUCKET=lyrics
   STORAGE_ENDPOINT=https://[PROJECT_REF].supabase.co/storage/v1/s3
   STORAGE_REGION=us-east-1
   STORAGE_ACCESS_KEY_ID=[S3_ACCESS_KEY_ID]
   STORAGE_SECRET_ACCESS_KEY=[S3_SECRET_ACCESS_KEY]
   STORAGE_FORCE_PATH_STYLE=true
   ```

4. Push database tables and run:
   ```bash
   pnpm db:push
   docker compose up -d api web
   ```

### Option C: Cloudflare R2 (10 GB Free Storage + Zero Egress Fees)

```env
STORAGE_BUCKET=lyrics
STORAGE_ENDPOINT=https://[CLOUDFLARE_ACCOUNT_ID].r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=[R2_ACCESS_KEY_ID]
STORAGE_SECRET_ACCESS_KEY=[R2_SECRET_ACCESS_KEY]
STORAGE_FORCE_PATH_STYLE=false
```

### Option D: Coolify Deployment
1. Create a **Docker Compose** resource in your Coolify dashboard.
2. Under **Domains**, set `https://lyricsdb.yourdomain.com` on the `web` service (port 3000). Next.js will automatically proxy all `/api/*` requests to the `api` service (port 4000).
3. Add your Supabase & Storage environment variables.
4. Click **Deploy**.

---

## Supported Formats

| Format              | Query Param                | Content-Type       | Precision               | Description                                                |
| :------------------ | :------------------------- | :----------------- | :---------------------- | :--------------------------------------------------------- |
| **JSON**            | `format=json`              | `application/json` | Syllable / Word / Plain | Compact token array `[vocalType, startMs, lengthMs, text]` |
| **TTML**            | `format=ttml`              | `application/xml`  | Syllable / Word         | Timed Text XML with word spans, background roles & duets   |
| **LRC**             | `format=lrc`               | `text/plain`       | Line-by-Line            | Standard timestamped `[mm:ss.xx]` lyric lines              |
| **LRCA2**           | `format=lrca2`             | `text/plain`       | Syllable                | Enhanced A2 LRC with syllable timing annotations           |
| **YRC**             | `format=yrc`               | `text/plain`       | Syllable                | NetEase Cloud Music syllable timing format                 |
| **QRC**             | `format=qrc`               | `text/plain`       | Syllable                | QQ Music syllable timing lyric format                      |
| **ESLRC**           | `format=eslrc`             | `text/plain`       | Syllable                | Extended Synced LRC format                                 |
| **ASS**             | `format=ass`               | `text/plain`       | Syllable / Karaoke      | Advanced SubStation Alpha karaoke subtitle format          |
| **LYL / LYS / LQE** | `format=lyl`, `lys`, `lqe` | `text/plain`       | Line / Syllable         | Specialized karaoke & player formats                       |

---

## API Examples

### 1. Fetch Synced Lyrics

```bash
# Fetch Apple Music-style TTML XML lyrics via Spotify URL
curl "http://localhost:4000/api/lyrics?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT&format=ttml"

# Fetch compact JSON lyrics via Spotify Track ID
curl "http://localhost:4000/api/lyrics?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT&format=json"
```

### 2. Retrieve Track Metadata

```bash
curl "http://localhost:4000/api/tracks?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT"
```

### 3. Real-Time SSE Stream

```bash
curl -N "http://localhost:4000/api/lyrics/stream?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT&format=json"
```

---

## Monorepo Architecture

```
lyricsdb/
├── apps/
│   ├── api/                 # NestJS backend API & WebSocket/SSE streaming
│   └── web/                 # Next.js 16 + Fumadocs documentation & lyrics player UI
├── packages/
│   ├── database/            # Drizzle ORM schema, migrations, and PostgreSQL client
│   ├── lyrics/              # Multi-tier lyrics extraction, matching & format conversion engine
│   ├── music-resolver/      # Cross-platform music link & ISRC metadata resolver
│   ├── types/               # Shared TypeScript schemas & definitions
│   ├── ui/                  # Shared React UI components
│   ├── eslint-config/       # Shared ESLint configuration
│   └── typescript-config/   # Shared tsconfig definitions
├── docker-compose.yml       # Docker Compose development & deployment
└── turbo.json               # Turborepo task pipeline configuration
```

---

## License

MIT © [LyricsDB Contributors](https://github.com/Anson10124/LyricsDB)
