import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { NavigationsService } from './navigations.service';
import { CreateNavigationDto, UpdateNavigationDto } from './navigations.dto';

@ApiTags('navigations')
@Controller('navigations')
@UseGuards(ClerkAuthGuard)
export class NavigationsController {
  constructor(private readonly navigations: NavigationsService) {}

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
