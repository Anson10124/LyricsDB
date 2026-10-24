import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { TurnstileConfigResponseDto } from "./dto/turnstile-config.dto";
import { TurnstileService } from "./turnstile.service";

@ApiTags("System")
@Controller(["api/turnstile", "turnstile"])
export class TurnstileController {
  constructor(private readonly turnstileService: TurnstileService) {}

  @ApiOperation({
    summary: "Get the public Turnstile configuration",
    description:
      "Returns the Cloudflare Turnstile site key the web app should render before protected actions, or null when human verification is disabled.",
  })
  @ApiOkResponse({ type: TurnstileConfigResponseDto })
  @Get("config")
  getConfig(): TurnstileConfigResponseDto {
    return { siteKey: this.turnstileService.getPublicSiteKey() };
  }
}
