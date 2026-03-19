import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsArray, IsInt, Min } from 'class-validator';

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
}

export class StopRecordingDto {
  @ApiProperty({ description: 'Run ID to stop' })
  @IsString()
  runId!: string;
}

export class InstructDto {
  @ApiProperty({ description: 'Natural language instruction for the browser' })
  @IsString()
  instruction!: string;
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
}
