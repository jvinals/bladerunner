import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsIn,
} from 'class-validator';

enum RunStatusDto {
  RECORDING = 'RECORDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

enum PlatformTypeDto {
  DESKTOP = 'DESKTOP',
  MOBILE = 'MOBILE',
  PWA = 'PWA',
}

export class StartRecordingDto {
  @ApiProperty({ description: 'Name of the test run' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'URL to record against' })
  @IsString()
  url!: string;

  @ApiPropertyOptional({ description: 'Optional project this run belongs to' })
  @IsOptional()
  @IsString()
  projectId?: string;
}

export class StopRecordingDto {
  @ApiProperty({ description: 'Run ID to stop' })
  @IsString()
  runId!: string;
}

export class StartPlaybackDto {
  @ApiPropertyOptional({
    description: 'Delay between steps in milliseconds (0–5000, default 600)',
    minimum: 0,
    maximum: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  delayMs?: number;

  @ApiPropertyOptional({
    description:
      'Use server env to sign in when Clerk UI is shown; skip clerkAuthPhase steps and AUTOMATIC-origin steps (no stored code replay for those).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoClerkSignIn?: boolean;

  @ApiPropertyOptional({
    enum: ['clerk_test_email', 'mailslurp'],
    description:
      'How to complete email OTP during auto sign-in. `mailslurp` (default when PLAYBACK_CLERK_OTP_MODE is unset): read OTP from MailSlurp (requires MAILSLURP_* env). `clerk_test_email`: identifier must include +clerk_test, fixed code 424242, no MailSlurp. Override via PLAYBACK_CLERK_OTP_MODE.',
  })
  @IsOptional()
  @IsIn(['clerk_test_email', 'mailslurp'])
  clerkOtpMode?: 'clerk_test_email' | 'mailslurp';

  @ApiPropertyOptional({
    description: 'Skip executing steps with sequence strictly less than this (legacy runs without metadata tags)',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skipUntilSequence?: number;

  @ApiPropertyOptional({
    description: 'Step IDs to skip during playback (always applied)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skipStepIds?: string[];

  @ApiPropertyOptional({
    description:
      'Stop playback after this step sequence completes (inclusive). Use with skipUntilSequence to play a single step (e.g. skipUntilSequence: 3, playThroughSequence: 3).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  playThroughSequence?: number;
}

export class ClerkAutoSignInRecordingDto {
  @ApiPropertyOptional({
    enum: ['clerk_test_email', 'mailslurp'],
    description:
      'Same as playback `clerkOtpMode`. Default follows PLAYBACK_CLERK_OTP_MODE or mailslurp when unset.',
  })
  @IsOptional()
  @IsIn(['clerk_test_email', 'mailslurp'])
  clerkOtpMode?: 'clerk_test_email' | 'mailslurp';
}

export class StopPlaybackDto {
  @ApiProperty({ description: 'Playback session ID returned from start playback' })
  @IsString()
  playbackSessionId!: string;
}

export class AdvancePlaybackToDto extends StopPlaybackDto {
  @ApiProperty({
    description: 'Run steps until this sequence completes (inclusive), then pause before the next step',
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stopAfterSequence!: number;
}

export class InstructDto {
  @ApiProperty({ description: 'Natural language instruction for the browser' })
  @IsString()
  instruction!: string;
}

export class ReRecordStepDto {
  @ApiProperty({ description: 'Natural language instruction to re-capture this step' })
  @IsString()
  instruction!: string;
}

export class PatchRunStepDto {
  @ApiPropertyOptional({
    description: 'Human-readable prompt for this step (required when enabling AI prompt mode)',
  })
  @IsOptional()
  @IsString()
  instruction?: string;

  @ApiPropertyOptional({
    description:
      'true: store as AI prompt step (LLM + vision at playback). false: revert to manual row (clears ai metadata).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  aiPromptMode?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, playback skips this step (still shown in the list). Allowed while recording or completed.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  excludedFromPlayback?: boolean;
}

export class SuggestSkipAfterChangeDto {
  @ApiProperty({ description: 'The step that was just added or edited (anchor)' })
  @IsString()
  anchorStepId!: string;
}

export class BulkSkipReplayDto {
  @ApiProperty({ description: 'Anchor step; only steps after this sequence can be marked' })
  @IsString()
  anchorStepId!: string;

  @ApiProperty({ description: 'Step IDs to mark as skip replay', type: [String] })
  @IsArray()
  @IsString({ each: true })
  stepIds!: string[];
}

export class CreateRunDto {
  @ApiProperty({ description: 'Name of the run' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Run description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'URL to test' })
  @IsString()
  url!: string;

  @ApiProperty({ enum: PlatformTypeDto, description: 'Target platform' })
  @IsEnum(PlatformTypeDto)
  @IsOptional()
  platform?: PlatformTypeDto;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

export class RunQueryDto {
  @ApiPropertyOptional({ enum: RunStatusDto, description: 'Filter by status' })
  @IsEnum(RunStatusDto)
  @IsOptional()
  status?: RunStatusDto;

  @ApiPropertyOptional({ enum: PlatformTypeDto, description: 'Filter by platform' })
  @IsEnum(PlatformTypeDto)
  @IsOptional()
  platform?: PlatformTypeDto;

  @ApiPropertyOptional({ description: 'Search term' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ['createdAt', 'name', 'durationMs', 'status', 'updatedAt'],
    description: 'Sort field',
  })
  @IsOptional()
  @IsIn(['createdAt', 'name', 'durationMs', 'status', 'updatedAt'])
  sortBy?: 'createdAt' | 'name' | 'durationMs' | 'status' | 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Sort direction' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
