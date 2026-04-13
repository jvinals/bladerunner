import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateNavigationDto {
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

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsIn(['mailslurp', 'clerk_test_email'])
  autoSignInClerkOtpMode?: 'mailslurp' | 'clerk_test_email' | null;
}

export class UpdateNavigationDto {
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

  @IsOptional()
  @IsIn(['continuous', 'step_review'])
  runMode?: 'continuous' | 'step_review';
}

export class NavigationPlayStartDto {
  @IsOptional()
  @IsObject()
  parameters?: Record<string, string>;
}

/** Body for POST …/actions/improve-instruction (LLM refines draft using step context). */
export class ImproveNavigationActionInstructionDto {
  @IsString()
  @MaxLength(8000)
  draft!: string;

  @IsInt()
  @Type(() => Number)
  sequence!: number;

  @IsString()
  @IsIn(['navigate', 'click', 'type', 'variable_input', 'prompt', 'prompt_type'])
  actionType!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  elementText?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  ariaLabel?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  inputValue?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  pageUrl?: string | null;
}

/** Body for PATCH …/actions/:sequence — persist optional Skyvern goal override. */
export class PatchNavigationActionInstructionDto {
  @IsDefined()
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(8000)
  actionInstruction!: string | null;
}
