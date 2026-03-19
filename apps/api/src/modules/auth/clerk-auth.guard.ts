import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/clerk-sdk-node';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private clerkClient;

  constructor(private configService: ConfigService) {
    const publishableKey =
      this.configService.get<string>('CLERK_PUBLISHABLE_KEY') ||
      this.configService.get<string>('VITE_CLERK_PUBLISHABLE_KEY');
    this.clerkClient = createClerkClient({
      secretKey: this.configService.get<string>('CLERK_SECRET_KEY'),
      publishableKey,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No authorization header found');
    }

    const token = authHeader.split(' ')[1];

    try {
      const sessionClaims = await this.clerkClient.verifyToken(token);
      request.user = sessionClaims;
      return true;
    } catch (error) {
      console.error('Clerk verification error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
