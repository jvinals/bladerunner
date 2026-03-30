import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

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
}

export class AnswerHumanDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsInt()
  @Min(0)
  selectedIndex!: number;
}
