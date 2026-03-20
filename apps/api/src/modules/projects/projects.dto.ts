import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum ProjectKindDto {
  WEB = 'WEB',
  IOS = 'IOS',
  ANDROID = 'ANDROID',
}

export class CreateProjectDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ enum: ProjectKindDto, default: ProjectKindDto.WEB })
  @IsOptional()
  @IsEnum(ProjectKindDto)
  kind?: ProjectKindDto;

  @ApiPropertyOptional({ description: 'Web URL or store / deeplink for mobile' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional({ description: 'APK / IPA / artifact download link' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  artifactUrl?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ProjectKindDto })
  @IsOptional()
  @IsEnum(ProjectKindDto)
  kind?: ProjectKindDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  artifactUrl?: string;
}
