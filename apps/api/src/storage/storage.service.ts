import { Injectable, Logger } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SyncedLyricsPayload } from "@repo/types";

export type LyricsPayload =
  | SyncedLyricsPayload
  | string
  | Record<string, unknown>;

interface CacheEntry {
  data: LyricsPayload;
  expiresAt: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private readonly bucket: string | null;
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly maxCacheSize = 1000;
  private readonly cacheTtlMs = 15 * 60 * 1000; // 15 minutes in-memory cache

  constructor() {
    const bucket = process.env.STORAGE_BUCKET || null;
    const endpoint = process.env.STORAGE_ENDPOINT || undefined;
    const region = process.env.STORAGE_REGION || "auto";
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
    const forcePathStyle =
      process.env.STORAGE_FORCE_PATH_STYLE === "true" ||
      (Boolean(endpoint) && !endpoint?.includes(".amazonaws.com"));

    this.bucket = bucket;

    if (bucket && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        endpoint,
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle,
      });

      this.logger.log(
        `Object storage initialized (Bucket: "${bucket}", Region: "${region}", Endpoint: ${endpoint || "AWS S3 standard"})`,
      );
    } else {
      this.logger.log(
        "Object storage is not configured (STORAGE_BUCKET / credentials unset). Operating in PostgreSQL-only mode.",
      );
    }
  }

  /**
   * Returns true if S3/Supabase/R2 storage is fully configured.
   */
  public isConfigured(): boolean {
    return Boolean(this.s3Client && this.bucket);
  }

  /**
   * Saves lyrics payload to Object Storage and returns the storage path key.
   */
  public async saveLyrics(key: string, lyrics: LyricsPayload): Promise<string> {
    if (!this.s3Client || !this.bucket) {
      throw new Error("Storage service is not configured.");
    }

    const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath = `lyrics/${cleanKey}.json`;
    const serialized = JSON.stringify(lyrics);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: serialized,
        ContentType: "application/json",
      }),
    );

    this.setCache(storagePath, lyrics);
    return storagePath;
  }

  /**
   * Retrieves lyrics payload from Object Storage (or local memory cache).
   */
  public async getLyrics(storagePath: string): Promise<LyricsPayload | null> {
    if (!storagePath) {
      return null;
    }

    // 1. Check in-memory cache
    const cached = this.getCache(storagePath);
    if (cached !== null) {
      return cached;
    }

    if (!this.s3Client || !this.bucket) {
      this.logger.warn(
        `Cannot fetch "${storagePath}": Object storage client is not configured.`,
      );
      return null;
    }

    // 2. Fetch from S3 bucket
    try {
      const res = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
        }),
      );

      if (!res.Body) {
        return null;
      }

      const bodyString = await res.Body.transformToString();
      const parsed = JSON.parse(bodyString) as LyricsPayload;

      // 3. Cache response
      this.setCache(storagePath, parsed);
      return parsed;
    } catch (err) {
      this.logger.error(
        `Failed to fetch lyrics from storage (${storagePath}):`,
        err,
      );
      return null;
    }
  }

  /**
   * Deletes lyrics object from Object Storage and cache.
   */
  public async deleteLyrics(storagePath: string): Promise<void> {
    this.memoryCache.delete(storagePath);

    if (!this.s3Client || !this.bucket) {
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to delete lyrics from storage (${storagePath}):`,
        err,
      );
    }
  }

  private getCache(key: string): LyricsPayload | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, data: LyricsPayload): void {
    if (this.memoryCache.size >= this.maxCacheSize) {
      // Evict oldest item
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) this.memoryCache.delete(firstKey);
    }

    this.memoryCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}
