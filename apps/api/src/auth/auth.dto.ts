import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

const PHONE = /^(\+91)?[6-9][0-9]{9}$/;
export class RequestOtpDto {
  @Matches(PHONE, { message: 'Enter a valid Indian mobile number' }) phone!: string;
}
export class VerifyOtpDto {
  @Matches(PHONE) phone!: string;
  @Length(6, 6) code!: string;
  /** Required only the first time a phone signs up. ADMIN accounts cannot self-register. */
  @IsOptional() @IsIn(['BUYER', 'FARMER', 'INSPECTOR', 'LOGISTICS']) role?: 'BUYER' | 'FARMER' | 'INSPECTOR' | 'LOGISTICS';
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsIn(['en', 'hi', 'as', 'bn']) language?: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
export class RefreshDto {
  @IsString() refreshToken!: string;
}
export class UpdateMeDto {
  @IsOptional() @IsIn(['en', 'hi', 'as', 'bn']) language?: string;
  @IsOptional() @IsString() @MinLength(2) name?: string;
}
