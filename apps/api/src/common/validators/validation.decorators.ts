import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";
import {
  ALLOWED_STREAMING_DOMAINS,
  normalizePlatform,
} from "@repo/music-resolver";
import {
  isSupportedLyricFormat,
  SUPPORTED_LYRIC_FORMATS,
} from "@repo/types";


/**
 * Validates that platform string is one of the supported providers.
 */
export function IsValidPlatform(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isValidPlatform",
      target: object.constructor,
      propertyName,
      options: {
        message:
          'Platform must be one of: "spotify", "apple", "deezer", "netease", "qq", "isrc"',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === "") return true;
          if (typeof value !== "string") return false;
          const norm = normalizePlatform(value.trim());
          return (
            norm === "spotify" ||
            norm === "apple" ||
            norm === "deezer" ||
            norm === "netease" ||
            norm === "qq" ||
            norm === "isrc"
          );
        },
      },
    });
  };
}

/**
 * Validates streaming platform track ID format based on platform context or general syntax.
 */
export function IsValidTrackId(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isValidTrackId",
      target: object.constructor,
      propertyName,
      options: {
        message:
          "Track ID contains invalid characters or does not match the expected format for the platform.",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null || value === "") return true;
          if (typeof value !== "string") return false;

          const trimmed = value.trim();
          if (trimmed.length === 0 || trimmed.length > 64) return false;

          // Check if platform is also provided on the DTO object
          const obj = args.object as { platform?: string };
          if (obj.platform) {
            const norm = normalizePlatform(obj.platform);
            switch (norm) {
              case "spotify":
                // 22 alphanumeric characters (base62)
                return /^[a-zA-Z0-9]{22}$/.test(trimmed);
              case "apple":
              case "deezer":
              case "netease":
                // Numeric ID string
                return /^\d{1,19}$/.test(trimmed);
              case "qq":
                // Numeric songid or 14-char songmid (e.g. 0039MnYb0qxYtV)
                return /^(?:\d{1,19}|[0-9a-zA-Z]{14})$/.test(trimmed);
              case "isrc":
                // 12-char standard ISRC
                return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(trimmed);
            }
          }

          // General sane ID format (alphanumeric, hyphens, underscores)
          return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
        },
      },
    });
  };
}

/**
 * Validates that URL is well-formed and belongs to an authorized streaming music platform.
 * Protects against SSRF and arbitrary malicious outbound requests.
 */
export function IsValidStreamingUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isValidStreamingUrl",
      target: object.constructor,
      propertyName,
      options: {
        message:
          "URL must be a valid streaming track URL from Spotify, Apple Music, Deezer, NetEase, or QQ Music.",
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === "") return true;
          if (typeof value !== "string") return false;

          const trimmed = value.trim();
          // Support spotify URI format e.g. spotify:track:4cOdK2wGLETKBW3PvgPWqT
          if (trimmed.startsWith("spotify:")) {
            return /^spotify:(?:track|album|playlist|artist):[a-zA-Z0-9]{22}$/.test(
              trimmed,
            );
          }

          try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return false;
            }

            const hostname = parsed.hostname.toLowerCase();
            return ALLOWED_STREAMING_DOMAINS.some(
              (domain) =>
                hostname === domain || hostname.endsWith(`.${domain}`),
            );
          } catch {
            return false;
          }
        },
      },
    });
  };
}

/**
 * Validates that requested output lyric format is supported.
 */
export function IsValidFormat(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isValidFormat",
      target: object.constructor,
      propertyName,
      options: {
        message: `Format must be one of: ${SUPPORTED_LYRIC_FORMATS.join(", ")}`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === "") return true;
          if (typeof value !== "string") return false;
          return isSupportedLyricFormat(value);
        },
      },
    });
  };
}

