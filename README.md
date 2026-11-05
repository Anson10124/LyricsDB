<h1 align="center">LyricsDB</h1>

<p align="center">
  <strong>Word-by-word synced lyrics for almost any song, with a beautiful player, a free API, and 11 export formats.</strong>
</p>

<p align="center">
  <a href="#free-public-api">Free public API</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#using-the-web-app">Web app</a> •
  <a href="#using-the-api">API</a> •
  <a href="#export-formats">Formats</a> •
  <a href="#self-hosting">Self-hosting</a> •
  <a href="#configuration">Configuration</a>
</p>

<p align="center">
  <img src=".github/assets/demo.webp" alt="Searching for Jingle Bells by Frank Sinatra in LyricsDB, watching the word-by-word synced lyrics and switching to the fullscreen player" width="800">
  <br>
  <sub>Search → pick a song → lyrics play word by word → go fullscreen. <i>(Shown: "Jingle Bells" by Frank Sinatra. The lyrics date from 1857 and are in the public domain.)</i></sub>
</p>

---

## What is LyricsDB?

LyricsDB finds **time-synced lyrics** for a song and keeps them in its own database, so the next lookup is instant.

You can give it a song name, or paste a link from **Spotify**, **Apple Music** or **Deezer**. LyricsDB then:

1. **Works out which song it is** on every major platform (Spotify, Apple Music, Deezer, NetEase Cloud Music, QQ Music, and its ISRC code).
2. **Asks several lyrics sources at once** and keeps the best result. Word-by-word timing beats line-by-line, which beats plain text.
3. **Saves the result**, so the lyrics come straight from the database next time.
4. **Shows the lyrics** in an Apple Music–style player, or **exports them** in the format your app or karaoke player needs.

It's useful if you're building a music player, a karaoke app, a Discord or Spotify overlay, or you just want good lyrics.

### Highlights

- **Word- and syllable-level timing**, including background vocals and duet parts
- **Translations and romanization** (e.g. romaji), which you can toggle in the player
- **Cross-platform matching** across Spotify, Apple Music, Deezer, NetEase, QQ Music and ISRC
- **11 export formats**: TTML, LRC, LRCA2, YRC, QRC, ESLRC, ASS, LYL, LYS, LQE and JSON
- **Live progress** over Server-Sent Events while new lyrics are being fetched
- **Community verification**: anyone can mark a track as correct, and verified tracks are protected from being overwritten
- **Library stats page** showing what's cached, which sources it came from, and how it's synced
- **Cheap to host**: PostgreSQL plus optional S3-compatible storage. It fits on Supabase or Cloudflare R2 free tiers.

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src=".github/assets/home.png" alt="LyricsDB home page with a search bar"></td>
    <td width="50%"><img src=".github/assets/search.png" alt="Search results dropdown showing matching songs"></td>
  </tr>
  <tr>
    <td align="center"><b>Home:</b> search by name or paste a link</td>
    <td align="center"><b>Search:</b> pick the right version with the keyboard or mouse</td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/assets/track.png" alt="Track page with metadata, platform links and the interactive lyrics player"></td>
    <td width="50%"><img src=".github/assets/formats.png" alt="QRC export view with word timings, copy and download buttons"></td>
  </tr>
  <tr>
    <td align="center"><b>Track page:</b> metadata, platform links and the live player</td>
    <td align="center"><b>Formats:</b> view, copy or download any export format</td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/assets/stats.png" alt="Library stats with sync-type chart and provider breakdown"></td>
    <td width="50%"><img src=".github/assets/docs.png" alt="Built-in documentation site"></td>
  </tr>
  <tr>
    <td align="center"><b>Stats:</b> what's in the library right now</td>
    <td align="center"><b>Docs:</b> built-in guides and API reference</td>
  </tr>
</table>

---

## Free public API

**You don't need to host anything to use LyricsDB.** There's a free public instance that's ready to use right now:

| What                    | Where                                                                          |
| :---------------------- | :----------------------------------------------------------------------------- |
| Website                 | [https://lyricsdb.kollod.dev](https://lyricsdb.kollod.dev)                     |
| API base URL            | `https://lyricsdb.kollod.dev/api`                                              |
| Interactive API docs    | [https://lyricsdb.kollod.dev/api/docs](https://lyricsdb.kollod.dev/api/docs)   |
| Guides                  | [https://lyricsdb.kollod.dev/docs](https://lyricsdb.kollod.dev/docs)           |
| Library stats           | [https://lyricsdb.kollod.dev/stats](https://lyricsdb.kollod.dev/stats)         |

Try it straight away:

```bash
curl "https://lyricsdb.kollod.dev/api/lyrics?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT&format=lrc"
```

No API key and no sign-up. The public instance already has a **large, growing library** of cached lyrics (most of them word-synced and community-verified), so many songs come back instantly.

**It's free, with fair-use rate limits per IP address:**

| Request type                                  | Limit          |
| :-------------------------------------------- | :------------- |
| Songs already in the database                 | 60 per minute  |
| New songs (fetched live from lyrics sources)  | 6 per minute   |
| Burst limit (all requests)                    | 15 per second  |

If you go over a limit, you get an HTTP `429` with a `retryAfter` value telling you how many seconds to wait. See the [rate limit guide](https://lyricsdb.kollod.dev/docs/rate-limits) for details.

### Public API or self-hosting?

|                         | Free public API                                    | Self-hosting                                                      |
| :---------------------- | :------------------------------------------------- | :---------------------------------------------------------------- |
| Setup                   | None. Just call the URL.                           | Docker or Node.js, plus a database                                |
| Lyrics library          | Already built and large                            | **Starts empty** and grows only as you look songs up              |
| First lookup of a song  | Instant for most songs                             | Every song is a slow live lookup the first time                   |
| Rate limits             | Fair-use limits (above)                            | You set your own                                                  |
| Best for                | Most apps, bots, overlays and personal projects    | Heavy use, private setups, or changing the code                   |

> **Good to know:** a self-hosted instance does **not** come with the public library. It starts from zero and has to fetch every song from the lyrics sources one by one, which is slower and is limited by those sources' own rate limits. For most people, the free public API is the easier choice.

---

## Quick start

> **Just want to use the API?** You can skip this whole section and use the [free public API](#free-public-api). The steps below are for running your own copy.

### Option 1: Docker (easiest)

You only need [Docker](https://docs.docker.com/get-docker/) installed.

```bash
git clone https://github.com/Anson10124/LyricsDB.git
cd LyricsDB
cp .env.example .env
docker compose up -d
```

This starts the database, the API and the website together. Open **http://localhost:3000** and search for a song. 
> Don't want to build the images yourself? `docker-compose.image.yml` uses the prebuilt images from `ghcr.io/anson10124/lyricsdb-api` and `ghcr.io/anson10124/lyricsdb-web` instead.

### Option 2: Run from source (for development)

**You'll need:** Node.js 18 or newer, [pnpm](https://pnpm.io/installation) 9 or newer, and Docker (only for the local database).

```bash
# 1. Get the code and install dependencies
git clone https://github.com/Anson10124/LyricsDB.git
cd LyricsDB
pnpm install

# 2. Create your settings file (the defaults work out of the box)
cp .env.example .env

# 3. Start a local PostgreSQL database and create the tables
pnpm db:up
pnpm db:push

# 4. Start the API and the website
pnpm dev
```

Once it's running:

| What                    | Where                                                    |
| :---------------------- | :------------------------------------------------------- |
| Website              | [http://localhost:3000](http://localhost:3000)           |
| API                  | [http://localhost:4000](http://localhost:4000)           |
| Interactive API docs | [http://localhost:4000/docs](http://localhost:4000/docs) |
| Guides               | [http://localhost:3000/docs](http://localhost:3000/docs) |

---

## Using the web app

1. **Search.** Type a song or artist, or paste a Spotify, Apple Music or Deezer link. Use <kbd>↑</kbd> <kbd>↓</kbd> and <kbd>Enter</kbd> to pick a result.
2. **Listen along.** The **Interactive** tab plays the lyrics in sync. Use the buttons to restart, show or hide the translation and romanization, or open the **fullscreen** player.
3. **Export.** Switch to any format tab (TTML, LRC, YRC, QRC, ASS, JSON…) to view the file, then **Copy** or **Download** it.
4. **Help keep it accurate.** If the song and lyrics are right, click **Mark as Correct**. Verified tracks are locked against automatic refreshes. If something looks wrong, **Refresh** fetches the lyrics again.

The **Stats** page (top right) shows how many tracks are cached, how they're synced, and which sources they came from.

---

## Using the API

All endpoints are plain HTTP GET requests, so you can try them in a browser or with `curl`. Full interactive documentation is at [lyricsdb.kollod.dev/api/docs](https://lyricsdb.kollod.dev/api/docs).

The examples below use the **free public API**. If you're self-hosting, swap `https://lyricsdb.kollod.dev` for your own address (for example `http://localhost:4000`).

**Get lyrics from a Spotify link (as TTML):**

```bash
curl "https://lyricsdb.kollod.dev/api/lyrics?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT&format=ttml"
```

**Get lyrics by platform + ID (as compact JSON):**

```bash
curl "https://lyricsdb.kollod.dev/api/lyrics?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT&format=json"
```

**Get track info only (title, artists, IDs on every platform):**

```bash
curl "https://lyricsdb.kollod.dev/api/tracks?platform=spotify&id=4cOdK2wGLETKBW3PvgPWqT"
```

**Watch progress live while new lyrics are fetched (Server-Sent Events):**

```bash
curl -N "https://lyricsdb.kollod.dev/api/lyrics/stream?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT&format=json"
```

> Already-cached tracks return instantly. To re-check a cached track against all sources, add `&forceRefresh=true` to the stream URL. If the refresh finds nothing usable, the existing lyrics are kept. Verified tracks are never overwritten.

---

## Export formats

Pick a format with the `format=` query parameter.

| Format              | Query param                | Content-Type       | Timing                  | What it's for                                                   |
| :------------------ | :------------------------- | :----------------- | :---------------------- | :-------------------------------------------------------------- |
| **JSON**            | `format=json`              | `application/json` | Syllable / Word / Plain | Compact token array `[vocalType, startMs, lengthMs, text]`      |
| **TTML**            | `format=ttml`              | `application/xml`  | Syllable / Word         | Apple Music–style Timed Text XML with background vocals & duets |
| **LRC**             | `format=lrc`               | `text/plain`       | Line                    | Classic `[mm:ss.xx]` lyrics supported by most players           |
| **LRCA2**           | `format=lrca2`             | `text/plain`       | Syllable                | Enhanced A2 LRC with per-syllable timing                        |
| **YRC**             | `format=yrc`               | `text/plain`       | Syllable                | NetEase Cloud Music format                                      |
| **QRC**             | `format=qrc`               | `text/plain`       | Syllable                | QQ Music format                                                 |
| **ESLRC**           | `format=eslrc`             | `text/plain`       | Syllable                | Extended Synced LRC                                             |
| **ASS**             | `format=ass`               | `text/plain`       | Syllable / Karaoke      | Karaoke subtitles for video players (Aegisub, mpv, VLC…)        |
| **LYL / LYS / LQE** | `format=lyl`, `lys`, `lqe` | `text/plain`       | Line / Syllable         | Specialized karaoke & lyric player formats                      |

---

## Where the lyrics come from

LyricsDB queries these sources in parallel and keeps the best match:

**AMLL TTML DB** · **lrc.red** · **QQ Music** · **Deezer** · **NetEase Cloud Music** · **Musixmatch** · **LRCLIB** · **Lyricify** *(optional)*

Word-synced results always win over line-synced ones, and line-synced over plain text. If one source is down, the others fill in.

<details>
<summary><b>Turning on the Lyricify source (optional)</b></summary>

<br>

Lyricify uses the track's Spotify ID that LyricsDB already resolved. You **don't** need Spotify developer credentials or OAuth. Add your account details to `.env`:

```env
LYRICIFY_SPOTIFY_USER_ID=your_spotify_user_id
LYRICIFY_SPOTIFY_EMAIL=your_account_email
# Optional
LYRICIFY_SPOTIFY_DISPLAY_NAME=your_display_name
LYRICIFY_SPOTIFY_REGION=GB
# LYRICIFY_VERSION=   # override the client build if needed
```

How it behaves:

- Complete Lyricify lyrics rank first **within their timing tier**. Word timing from another source still beats Lyricify line timing.
- Duet and background-vocal roles, original timings and translations are kept. Credit lines and server metadata are removed.
- If it isn't configured or fails, LyricsDB quietly falls back to the other sources.

</details>

---

## Self-hosting

> **Before you start:** your own instance begins with an **empty database**. It won't have the lyrics that are already in the [free public API](#free-public-api), so every song has to be fetched live from the lyrics sources the first time someone looks it up. If you just want lyrics, the public API is usually the better option.

Pick whichever setup suits you. All of them use the same `.env` file. Each option below expands.

<details>
<summary><b>A. Everything local with Docker</b> (no accounts needed)</summary>

<br>

```bash
docker compose up -d
```

This runs PostgreSQL, the NestJS API and the Next.js website on your machine. Lyrics are stored directly in PostgreSQL.

</details>

<details>
<summary><b>B. Supabase</b> (free tier: 500 MB database + 1 GB storage)</summary>

<br>

1. Create a project on [Supabase](https://supabase.com).
2. In **Storage**, create a bucket named `lyrics`.
3. Add this to your `.env`:

   ```env
   # Database
   DATABASE_URL=postgres://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   DIRECT_URL=postgres://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   DATABASE_SSL=require

   # Storage (S3 protocol)
   STORAGE_BUCKET=lyrics
   STORAGE_ENDPOINT=https://[PROJECT_REF].supabase.co/storage/v1/s3
   STORAGE_REGION=us-east-1
   STORAGE_ACCESS_KEY_ID=[S3_ACCESS_KEY_ID]
   STORAGE_SECRET_ACCESS_KEY=[S3_SECRET_ACCESS_KEY]
   STORAGE_FORCE_PATH_STYLE=true
   ```

4. Create the tables and start the app:

   ```bash
   pnpm db:push
   docker compose up -d api web
   ```

</details>

<details>
<summary><b>C. Cloudflare R2 storage</b> (10 GB free, no egress fees)</summary>

<br>

Use any PostgreSQL database, and store the lyrics files in R2:

```env
STORAGE_BUCKET=lyrics
STORAGE_ENDPOINT=https://[CLOUDFLARE_ACCOUNT_ID].r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=[R2_ACCESS_KEY_ID]
STORAGE_SECRET_ACCESS_KEY=[R2_SECRET_ACCESS_KEY]
STORAGE_FORCE_PATH_STYLE=false
```

</details>

<details>
<summary><b>D. Coolify</b></summary>

<br>

1. In your Coolify dashboard, create a **Docker Compose** resource from this repository.
2. Under **Domains**, set your domain (e.g. `https://lyricsdb.yourdomain.com`) on the `web` service, port `3000`. The website forwards all `/api/*` requests to the `api` service on port `4000`.
3. Add your database and storage environment variables.
4. Click **Deploy**.

</details>

> **Why object storage?** The lyrics files are kept in S3-compatible storage, and PostgreSQL only holds a small index. That keeps the database tiny, so a free tier can hold **1,000,000+ tracks**. Without storage settings, everything stays in PostgreSQL, which works fine for smaller libraries.

---

## Configuration

Every setting is **optional**. LyricsDB runs locally without editing `.env`. See [`.env.example`](.env.example) for the full list with comments.

| Variable                                           | What it does                                                                  |
| :------------------------------------------------- | :---------------------------------------------------------------------------- |
| `DATABASE_URL` / `DIRECT_URL`                      | PostgreSQL connection (defaults to the local Docker database)                 |
| `DATABASE_SSL`                                     | Set to `require` for hosted databases (auto-enabled for Supabase)             |
| `STORAGE_*`                                        | S3-compatible storage for lyrics files (Supabase Storage, R2, AWS S3, MinIO) |
| `PORT`                                             | API port (default `4000`)                                                     |
| `PUBLIC_URL`                                       | Your public domain, used in the API docs                                      |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`      | Cloudflare Turnstile human check for **Mark as Correct** (off when empty)     |
| `API_INTERNAL_URL` / `NEXT_PUBLIC_API_URL`         | Where the website sends API requests (auto-detected by default)               |
| `LYRICIFY_*`                                       | Enables the optional Lyricify source ([see above](#where-the-lyrics-come-from)) |

---

## Project structure

LyricsDB is a [Turborepo](https://turbo.build/) monorepo:

```
lyricsdb/
├── apps/
│   ├── api/                 # NestJS backend: REST API, SSE streaming, Swagger docs
│   └── web/                 # Next.js 16 website: search, lyrics player, stats & Fumadocs docs
├── packages/
│   ├── database/            # Drizzle ORM schema, migrations and PostgreSQL client
│   ├── lyrics/              # Lyrics fetching, matching and format conversion engine
│   ├── music-resolver/      # Cross-platform link & ISRC resolver
│   ├── types/               # Shared TypeScript types
│   ├── ui/                  # Shared React components
│   ├── eslint-config/       # Shared ESLint config
│   └── typescript-config/   # Shared tsconfig presets
├── docker-compose.yml       # Build & run the full stack
└── turbo.json               # Turborepo task pipeline
```

### Useful scripts

| Command                       | What it does                                  |
| :---------------------------- | :-------------------------------------------- |
| `pnpm dev`                    | Run the API and website with hot reload       |
| `pnpm dev:api` / `pnpm dev:web` | Run just one of them                        |
| `pnpm build`                  | Build everything for production               |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local PostgreSQL container   |
| `pnpm db:push`                | Create or update the database tables          |
| `pnpm db:studio`              | Browse the database in Drizzle Studio         |
| `pnpm lint` / `pnpm check-types` | Lint and type-check the whole repo         |

---

## License

[MIT](LICENSE) © [LyricsDB Contributors](https://github.com/Anson10124/LyricsDB)
