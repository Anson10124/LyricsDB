// Finds tracks whose stored lyrics are Musixmatch's decoy gibberish
// ("Wob gopini den / Tefe woxica fero / ...") and clears their lyrics fields,
// so the next request for each track fetches lyrics again.
//
// Dry run (only reports):  node --env-file=../../.env scripts/clear-musixmatch-decoys.mts
// Apply the cleanup:       node --env-file=../../.env scripts/clear-musixmatch-decoys.mts --apply
//
// Run from apps/api after `pnpm build` so the workspace packages are up to date.
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db, eq, ilike, inArray, tracks } from "@repo/database";
import { isMusixmatchDecoyLyrics } from "@repo/lyrics";

const apply = process.argv.includes("--apply");

function createStorageClient(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const endpoint = process.env.STORAGE_ENDPOINT || undefined;
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env.STORAGE_REGION || "auto",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle:
        process.env.STORAGE_FORCE_PATH_STYLE === "true" ||
        (Boolean(endpoint) && !endpoint?.includes(".amazonaws.com")),
    }),
  };
}

async function readStoredLyrics(
  storage: { client: S3Client; bucket: string },
  path: string,
): Promise<string | null> {
  const res = await storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: path }),
  );
  return (await res.Body?.transformToString()) ?? null;
}

async function main(): Promise<void> {
  const storage = createStorageClient();

  const candidates = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artists: tracks.artists,
      lyrics: tracks.lyrics,
      lyricsStoragePath: tracks.lyricsStoragePath,
    })
    .from(tracks)
    .where(ilike(tracks.lyricsProvider, "%musixmatch%"));

  const decoyIds: string[] = [];
  let unreadable = 0;

  for (const track of candidates) {
    let text: string | null = null;
    try {
      if (track.lyricsStoragePath) {
        if (!storage) throw new Error("object storage is not configured");
        text = await readStoredLyrics(storage, track.lyricsStoragePath);
      } else if (track.lyrics != null) {
        text =
          typeof track.lyrics === "string"
            ? track.lyrics
            : JSON.stringify(track.lyrics);
      }
    } catch (err) {
      unreadable++;
      console.warn(`  ! ${track.id}: could not read lyrics (${String(err)})`);
      continue;
    }

    const isDecoy = text != null && isMusixmatchDecoyLyrics(text);
    const label = `${track.title} - ${track.artists.join(", ")}`;
    console.log(`${isDecoy ? "DECOY" : "ok   "}  ${track.id}  ${label}`);
    if (isDecoy) decoyIds.push(track.id);
  }

  console.log(
    `\n${candidates.length} Musixmatch tracks checked, ${decoyIds.length} have decoy lyrics, ${unreadable} unreadable.`,
  );

  if (!apply) {
    if (decoyIds.length > 0) console.log("Dry run: re-run with --apply to clear them.");
    return;
  }

  if (decoyIds.length > 0) {
    // Back-date updated_at past the API's one-hour lyrics retry interval so the
    // next request for each track fetches lyrics right away
    const retryNow = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cleared = await db
      .update(tracks)
      .set({
        lyricsType: null,
        lyrics: null,
        lyricsStoragePath: null,
        lyricsProvider: null,
        hasTranslation: false,
        hasRomaji: false,
        updatedAt: retryNow,
      })
      .where(inArray(tracks.id, decoyIds))
      .returning({ id: tracks.id });
    console.log(`Cleared lyrics on ${cleared.length} tracks.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
