import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export enum ProjectKindDto {
  WEB = 'WEB',
  IOS = 'IOS',
  ANDROID = 'ANDROID',
}

export enum TestEmailProviderDto {
  MAILSLURP = 'MAILSLURP',
  CLERK_TEST_EMAIL = 'CLERK_TEST_EMAIL',
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

  @ApiPropertyOptional({ description: 'Hex color for UI display, e.g. #4B90FF' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a hex color like #4B90FF' })
  color?: string;

  @ApiPropertyOptional({ description: 'Email for automated test sign-in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  testUserEmail?: string;

  @ApiPropertyOptional({ description: 'Password for automated test sign-in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  testUserPassword?: string;

  @ApiPropertyOptional({ enum: TestEmailProviderDto, description: 'Email provider for OTP retrieval' })
  @IsOptional()
  @IsEnum(TestEmailProviderDto)
  testEmailProvider?: TestEmailProviderDto;
}

export class PatchAgentKnowledgeDto {
  @ApiPropertyOptional({ description: 'Manual instructions merged into agent prompts for this project' })
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  manualInstructions?: string | null;
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

  @ApiPropertyOptional({ description: 'Hex color for UI display, e.g. #4B90FF' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a hex color like #4B90FF' })
  color?: string;

  @ApiPropertyOptional({ description: 'Email for automated test sign-in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  testUserEmail?: string;

  @ApiPropertyOptional({ description: 'Password for automated test sign-in' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  testUserPassword?: string;

  @ApiPropertyOptional({ enum: TestEmailProviderDto, description: 'Email provider for OTP retrieval' })
  @IsOptional()
  @IsEnum(TestEmailProviderDto)
  testEmailProvider?: TestEmailProviderDto;
}
