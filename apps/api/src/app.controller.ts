import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AppService } from "./app.service";

@ApiTags("System")
@Controller(["api", ""])
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: "API Service Information & Endpoints",
    description:
      "Returns metadata, versioning information, and available endpoint directory.",
  })
  @ApiOkResponse({
    description: "API operational info and service metadata",
    schema: {
      type: "object",
      properties: {
        service: { type: "string", example: "LyricsDB API" },
        version: { type: "string", example: "1.0.0" },
        status: { type: "string", example: "operational" },
        endpoints: { type: "object" },
      },
    },
  })
  @Get()
  getRoot() {
    return this.appService.getInfo();
  }

  @ApiOperation({
    summary: "Health Check",
    description: "Returns current server health status and timestamp.",
  })
  @ApiOkResponse({
    description: "Health check response",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        message: { type: "string", example: "LyricsDB API is running" },
        timestamp: { type: "string", example: "2026-08-20T22:31:20.790Z" },
      },
    },
  })
  @Get("health")
  getHealth() {
    return this.appService.getHealth();
  }
}
