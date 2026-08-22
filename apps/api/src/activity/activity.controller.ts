import { Controller, Get, MessageEvent, Sse } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Observable } from "rxjs";
import { ActivityService } from "./activity.service";

@ApiTags("Activity")
@Controller(["api/activity", "activity", "api/live", "live"])
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @ApiOperation({
    summary: "Stream real-time database additions via SSE",
    description:
      "Server-Sent Events endpoint streaming live events whenever tracks are added to the database. Emits total tracks count upon initialization followed by live added tracks and keep-alive heartbeats.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Server-Sent Events stream emitting 'init', 'added', and 'heartbeat' payloads",
    content: {
      "text/event-stream": {
        schema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["init", "added", "heartbeat"],
              example: "added",
            },
            id: {
              type: "string",
              example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
            },
            totalTracks: {
              type: "integer",
              description: "Total number of tracks in database (sent on 'init')",
              example: 42,
            },
            track: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  example: "6fd7cc30-22d2-4789-9c9e-3029337fd522",
                },
                title: {
                  type: "string",
                  example: "Please Please Please",
                },
                artist: {
                  type: "string",
                  example: "Sabrina Carpenter",
                },
                artworkUrl: {
                  type: "string",
                  example: "https://is1-ssl.mzstatic.com/.../600x600bb.jpg",
                },
              },
            },
            timestamp: { type: "integer", example: 1787262680794 },
          },
        },
      },
    },
  })
  @SkipThrottle()
  @Sse("stream")
  streamActivity(): Observable<MessageEvent> {
    return this.activityService.getActivityStream();
  }

  @ApiOperation({
    summary: "Stream real-time activity (root alias)",
    description: "Alias for /api/activity/stream",
  })
  @SkipThrottle()
  @Sse("")
  streamActivityRoot(): Observable<MessageEvent> {
    return this.activityService.getActivityStream();
  }

  @ApiOperation({
    summary: "Get total number of tracks in the database",
  })
  @ApiOkResponse({
    description: "Total track count",
  })
  @Get("count")
  async getCount(): Promise<{ totalTracks: number }> {
    const totalTracks = await this.activityService.getTotalTracks();
    return { totalTracks };
  }
}
