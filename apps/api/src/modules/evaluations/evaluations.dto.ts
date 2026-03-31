import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  intent!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  desiredOutput!: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID('4')
  projectId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoSignIn?: boolean;

  /** When Clerk is detected; omit or null to use server `PLAYBACK_CLERK_OTP_MODE` (defaults to mailslurp). */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsIn(['mailslurp', 'clerk_test_email'])
  autoSignInClerkOtpMode?: 'mailslurp' | 'clerk_test_email' | null;
}

export class AnswerHumanDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsInt()
  @Min(0)
  selectedIndex!: number;
}

export class UpdateEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  intent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  desiredOutput?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID('4')
  projectId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoSignIn?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsIn(['mailslurp', 'clerk_test_email'])
  autoSignInClerkOtpMode?: 'mailslurp' | 'clerk_test_email' | null;
}
