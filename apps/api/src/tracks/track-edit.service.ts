import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  DatabaseClient,
  eq,
  ne,
  PLATFORM_ID_COLUMNS,
  type PlatformIdKey,
  type Track,
  trackPlatformIds,
  trackRejectedPlatformIds,
  trackRevisions,
  type TrackRevisionSnapshot,
  tracks,
} from "@repo/database";
import {
  editedLyricFlags,
  lyricsOverrunToleranceMs,
  payloadEndMs,
  validateEditedLyrics,
} from "@repo/lyrics";
import type { SyncedLyricsPayload } from "@repo/types";

import { DATABASE_CONNECTION } from "../database/database.constants";
import { IpRateLimiterService } from "../common/rate-limiter/ip-rate-limiter.service";
import { StorageService } from "../storage/storage.service";
import { PLATFORM_TRACK_FIELDS, type TrackIdField } from "./platform-ids";
import { COMMUNITY_LYRICS_PROVIDER } from "./refresh-lock";

export interface TrackEditInput {
  // The track's updatedAt when the editor opened; a newer row means someone else saved first
  baseUpdatedAt?: string;
  lyrics?: unknown;
  ids?: Partial<Record<TrackIdField, string | null>>;
}

// What each platform's IDs look like. Loose enough for every catalog's real IDs,
// strict enough to catch a pasted URL or a typo.
const ID_FORMATS: Record<PlatformIdKey, RegExp> = {
  spotify: /^[A-Za-z0-9]{22}$/,
  apple: /^\d{1,20}$/,
  deezer: /^\d{1,20}$/,
  netease: /^\d{1,20}$/,
  qq: /^[A-Za-z0-9]{1,32}$/,
  isrc: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/,
};

const PLATFORM_LABELS: Record<PlatformIdKey, string> = {
  spotify: "Spotify ID",
  apple: "Apple Music ID",
  deezer: "Deezer ID",
  netease: "NetEase ID",
  qq: "QQ Music ID",
  isrc: "ISRC",
};

interface IdChange {
  platform: PlatformIdKey;
  field: TrackIdField;
  from: string | null;
  to: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "23505",
  );
}

@Injectable()
export class TrackEditService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
    private readonly storageService: StorageService,
    private readonly ipRateLimiter: IpRateLimiterService,
  ) {}

  /**
   * Saves a community edit of a track's lyrics and/or platform IDs. The previous
   * state is stored in track_revisions first, saving clears the Verified badge, and
   * edited lyrics are marked as community lyrics so a refresh can't replace them.
   */
  async editTrack(
    id: string,
    input: TrackEditInput,
    clientIp = "127.0.0.1",
  ): Promise<Track> {
    this.ipRateLimiter.consume(clientIp, "cached");

    const [track] = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.id, id))
      .limit(1);
    if (!track) throw new NotFoundException(`Track with id ${id} not found.`);

    if (
      input.baseUpdatedAt &&
      new Date(input.baseUpdatedAt).getTime() !==
        new Date(track.updatedAt).getTime()
    ) {
      throw new ConflictException(
        "This track was changed after you opened the editor. Reload the page to get the latest version, then make your edit again.",
      );
    }

    const currentLyrics = await this.currentLyrics(track);
    const newLyrics = this.checkLyrics(track, currentLyrics, input.lyrics);
    const idChanges = this.checkIds(track, input.ids);
    if (!newLyrics && idChanges.length === 0) {
      throw new BadRequestException("Nothing was changed.");
    }
    await this.assertIdsAreFree(track.id, idChanges);

    const [revision] = await this.db
      .insert(trackRevisions)
      .values({
        trackId: track.id,
        previous: this.snapshot(track, currentLyrics),
        changed: [
          ...(newLyrics ? ["lyrics"] : []),
          ...(idChanges.length > 0 ? ["ids"] : []),
        ],
        editorHash: this.hashIp(clientIp),
      })
      .returning({ id: trackRevisions.id });

    const update: Partial<Track> = { isVerified: false, updatedAt: new Date() };
    if (newLyrics) {
      Object.assign(update, await this.storeLyrics(track, newLyrics, revision?.id));
    }
    for (const change of idChanges) {
      (update as Record<string, string | null>)[change.field] = change.to;
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [saved] = await tx
          .update(tracks)
          .set(update)
          .where(eq(tracks.id, track.id))
          .returning();

        for (const change of idChanges) {
          if (change.from) {
            // The old ID was a wrong match: stop it resolving here, and keep it out
            await tx
              .delete(trackPlatformIds)
              .where(
                and(
                  eq(trackPlatformIds.platform, change.platform),
                  eq(trackPlatformIds.platformId, change.from),
                  eq(trackPlatformIds.trackId, track.id),
                ),
              );
            await tx
              .insert(trackRejectedPlatformIds)
              .values({
                trackId: track.id,
                platform: change.platform,
                platformId: change.from,
              })
              .onConflictDoNothing();
          }
          if (change.to) {
            await tx
              .delete(trackRejectedPlatformIds)
              .where(
                and(
                  eq(trackRejectedPlatformIds.trackId, track.id),
                  eq(trackRejectedPlatformIds.platform, change.platform),
                  eq(trackRejectedPlatformIds.platformId, change.to),
                ),
              );
            await tx
              .insert(trackPlatformIds)
              .values({
                trackId: track.id,
                platform: change.platform,
                platformId: change.to,
              })
              .onConflictDoNothing();
          }
        }

        if (!saved) throw new NotFoundException(`Track with id ${id} not found.`);
        return saved;
      });
    } catch (err) {
      // Another save took one of the new IDs after the check above
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "One of these IDs was just given to another track. Reload and try again.",
        );
      }
      throw err;
    }
  }

  private async currentLyrics(
    track: Track,
  ): Promise<TrackRevisionSnapshot["lyrics"]> {
    if (track.lyrics) return track.lyrics;
    if (track.lyricsStoragePath) {
      return this.storageService.getLyrics(track.lyricsStoragePath);
    }
    return null;
  }

  // The edited payload, or null when the lyrics were not changed
  private checkLyrics(
    track: Track,
    current: TrackRevisionSnapshot["lyrics"],
    edited: unknown,
  ): SyncedLyricsPayload | null {
    if (edited === undefined || edited === null) return null;
    if (!Array.isArray(current)) {
      throw new BadRequestException(
        "Only synced lyrics can be edited for this track.",
      );
    }

    const problem = validateEditedLyrics(edited);
    if (problem) throw new BadRequestException(problem);
    const payload = edited as SyncedLyricsPayload;

    if (track.durationMs > 0 && !track.needsEnrichment) {
      const limit =
        track.durationMs + lyricsOverrunToleranceMs(track.durationMs);
      if (payloadEndMs(payload) > limit) {
        throw new BadRequestException(
          "The lyrics run past the end of the song. Check the offset and line times.",
        );
      }
    }

    return JSON.stringify(payload) === JSON.stringify(current) ? null : payload;
  }

  private checkIds(
    track: Track,
    ids: TrackEditInput["ids"],
  ): IdChange[] {
    if (!ids) return [];
    const changes: IdChange[] = [];

    for (const [platform, field] of Object.entries(PLATFORM_TRACK_FIELDS) as Array<
      [PlatformIdKey, TrackIdField]
    >) {
      if (!(field in ids)) continue;
      const raw = ids[field];
      if (raw !== null && typeof raw !== "string") {
        throw new BadRequestException(`${PLATFORM_LABELS[platform]} must be text.`);
      }
      let value = raw?.trim() || null;
      if (value && platform === "isrc") value = value.toUpperCase();
      if (value && !ID_FORMATS[platform].test(value)) {
        throw new BadRequestException(
          `${PLATFORM_LABELS[platform]} "${value.slice(0, 64)}" doesn't look right.`,
        );
      }
      const from = track[field] ?? null;
      if (value !== from) changes.push({ platform, field, from, to: value });
    }
    return changes;
  }

  // An ID can belong to only one track
  private async assertIdsAreFree(
    trackId: string,
    changes: IdChange[],
  ): Promise<void> {
    for (const change of changes) {
      if (!change.to) continue;
      const [column] = await this.db
        .select({ id: tracks.id })
        .from(tracks)
        .where(
          and(eq(PLATFORM_ID_COLUMNS[change.platform], change.to), ne(tracks.id, trackId)),
        )
        .limit(1);
      const [alias] = column
        ? [column]
        : await this.db
            .select({ id: trackPlatformIds.trackId })
            .from(trackPlatformIds)
            .where(
              and(
                eq(trackPlatformIds.platform, change.platform),
                eq(trackPlatformIds.platformId, change.to),
                ne(trackPlatformIds.trackId, trackId),
              ),
            )
            .limit(1);
      if (alias) {
        throw new ConflictException({
          message: `That ${PLATFORM_LABELS[change.platform]} already belongs to another track.`,
          error: "Conflict",
          trackId: alias.id,
        });
      }
    }
  }

  private snapshot(
    track: Track,
    lyrics: TrackRevisionSnapshot["lyrics"],
  ): TrackRevisionSnapshot {
    return {
      lyrics,
      lyricsType: track.lyricsType ?? null,
      lyricsProvider: track.lyricsProvider ?? null,
      hasTranslation: track.hasTranslation,
      hasRomaji: track.hasRomaji,
      isVerified: track.isVerified,
      ids: {
        isrc: track.isrc,
        spotifyId: track.spotifyId,
        appleMusicId: track.appleMusicId,
        deezerId: track.deezerId,
        neteaseId: track.neteaseId,
        qqMusicId: track.qqMusicId,
      },
    };
  }

  // Each edit gets its own storage object, so the row keeps pointing at the old
  // lyrics until the database update below succeeds
  private async storeLyrics(
    track: Track,
    payload: SyncedLyricsPayload,
    revisionId: string | undefined,
  ): Promise<Partial<Track>> {
    const flags = editedLyricFlags(payload);
    const fields = { ...flags, lyricsProvider: COMMUNITY_LYRICS_PROVIDER };
    if (!this.storageService.isConfigured()) {
      return { ...fields, lyrics: payload, lyricsStoragePath: null };
    }
    const path = await this.storageService.saveLyrics(
      `${track.id}_edit_${revisionId ?? Date.now()}`,
      payload,
    );
    return { ...fields, lyrics: null, lyricsStoragePath: path };
  }

  // Salted so the stored value can't be reversed into an IP with a lookup table
  private hashIp(ip: string): string {
    const salt = process.env.TURNSTILE_SECRET_KEY ?? "";
    return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  }
}
