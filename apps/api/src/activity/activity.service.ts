import { randomUUID } from "node:crypto";
import { Inject, Injectable, MessageEvent } from "@nestjs/common";
import { count, DatabaseClient, Track, tracks } from "@repo/database";
import type {
  ActivityEvent,
  ActivityTrackSummary,
} from "@repo/types";
import { formatArtworkUrl } from "@repo/music-resolver";

import { concat, from, interval, map, merge, Observable, Subject } from "rxjs";
import { DATABASE_CONNECTION } from "../database/database.constants";

@Injectable()
export class ActivityService {
  private readonly activitySubject = new Subject<ActivityEvent>();
  private readonly recentAddedIds = new Set<string>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DatabaseClient,
  ) {}

  public async getTotalTracks(): Promise<number> {
    try {
      const result = await this.db.select({ value: count() }).from(tracks);
      return Number(result[0]?.value || 0);
    } catch (err) {
      console.warn("[ActivityService] Failed to count total tracks:", err);
      return 0;
    }
  }

  public formatTrackSummary(track: Partial<Track>): ActivityTrackSummary {
    const artist =
      Array.isArray(track.artists) && track.artists.length > 0
        ? track.artists.join(", ")
        : (track as { artist?: string }).artist || "Unknown Artist";

    return {
      id: track.id || "",
      title: track.title || "Unknown Title",
      artist,
      artworkUrl: formatArtworkUrl(track.artwork, 600) || null,
    };
  }


  public recordTrackAdded(track: Partial<Track>): ActivityEvent | null {
    if (!track || !track.title) {
      return null;
    }

    const summary = this.formatTrackSummary(track);
    if (summary.id && this.recentAddedIds.has(summary.id)) {
      return null;
    }

    if (summary.id) {
      this.recentAddedIds.add(summary.id);
      setTimeout(() => {
        this.recentAddedIds.delete(summary.id);
      }, 10000);
    }

    const event: ActivityEvent = {
      id: randomUUID(),
      type: "added",
      track: summary,
      timestamp: Date.now(),
    };

    // Broadcast to live SSE subscribers
    this.activitySubject.next(event);
    return event;
  }

  public getActivityStream(): Observable<MessageEvent> {
    // 1. Initial snapshot sending total number of songs in database
    const initial$: Observable<MessageEvent> = from(this.getTotalTracks()).pipe(
      map((totalTracks) => ({
        data: {
          type: "init",
          totalTracks,
          timestamp: Date.now(),
        },
      } as MessageEvent)),
    );

    // 2. Real-time stream of newly added tracks
    const live$: Observable<MessageEvent> = this.activitySubject.pipe(
      map((event) => ({
        data: {
          type: "added",
          id: event.id,
          track: event.track,
          timestamp: event.timestamp,
        },
      } as MessageEvent)),
    );

    // 3. Keep-alive heartbeat every 25 seconds
    const heartbeat$: Observable<MessageEvent> = interval(25000).pipe(
      map(() => ({
        data: {
          type: "heartbeat",
          timestamp: Date.now(),
        },
      } as MessageEvent)),
    );

    return concat(initial$, merge(live$, heartbeat$));
  }
}
