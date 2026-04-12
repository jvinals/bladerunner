import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { NavigationsService } from './navigations.service';
import { NavigationPlayService } from './navigation-play.service';
import { CreateNavigationDto, NavigationPlayStartDto, UpdateNavigationDto } from './navigations.dto';

@ApiTags('navigations')
@Controller('navigations')
@UseGuards(ClerkAuthGuard)
export class NavigationsController {
  constructor(
    private readonly navigations: NavigationsService,
    private readonly navigationPlay: NavigationPlayService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List navigations' })
  list(@Req() req: { user: { sub: string } }) {
    return this.navigations.findAll(req.user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Create navigation' })
  create(@Req() req: { user: { sub: string } }, @Body() dto: CreateNavigationDto) {
    return this.navigations.create(req.user.sub, {
      name: dto.name,
      url: dto.url,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode ?? null,
    });
  }

  @Get(':id/recording-session')
  @ApiOperation({ summary: 'Live recording/play session flags for Continue recording UI' })
  recordingSession(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigations.getLiveSessions(id, req.user.sub);
  }

  @Post(':id/play/start')
  @ApiOperation({ summary: 'Start Skyvern workflow run against browser-worker CDP' })
  playStart(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() body: NavigationPlayStartDto,
  ) {
    return this.navigationPlay.startPlay(id, req.user.sub, body?.parameters);
  }

  @Post(':id/play/stop')
  @ApiOperation({ summary: 'Cancel Skyvern play run' })
  playStop(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigationPlay.stopPlay(id, req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get navigation' })
  findOne(@Req() req: { user: { sub: string } }, @Param('id') id: string) {
    return this.navigations.findOne(id, req.user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update navigation fields' })
  patch(
    @Req() req: { user: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateNavigationDto,
  ) {
    return this.navigations.updateFields(id, req.user.sub, {
      name: dto.name,
      intent: dto.intent,
      desiredOutput: dto.desiredOutput,
      projectId: dto.projectId,
      autoSignIn: dto.autoSignIn,
      autoSignInClerkOtpMode: dto.autoSignInClerkOtpMode,
      runMode: dto.runMode,
    });
  }
}
