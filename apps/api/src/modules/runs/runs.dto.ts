import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';

enum RunStatusDto {
  Queued = 'queued',
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  NeedsReview = 'needs_review',
  Cancelled = 'cancelled',
}

enum PlatformTypeDto {
  Desktop = 'desktop',
  Mobile = 'mobile',
  PWA = 'pwa',
}

export class CreateRunDto {
  @ApiProperty({ description: 'Name of the run' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Run description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Project ID' })
  @IsString()
  projectId: string;

  @ApiProperty({ enum: PlatformTypeDto, description: 'Target platform' })
  @IsEnum(PlatformTypeDto)
  platform: PlatformTypeDto;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

export class UpdateRunDto {
  @ApiPropertyOptional({ description: 'Run name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: RunStatusDto, description: 'Run status' })
  @IsEnum(RunStatusDto)
  @IsOptional()
  status?: RunStatusDto;
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
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  pageSize?: number;
}
