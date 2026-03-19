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
    this.clerkClient = createClerkClient({
      secretKey: this.configService.get<string>('CLERK_SECRET_KEY'),
      publishableKey: this.configService.get<string>('VITE_CLERK_PUBLISHABLE_KEY'),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'clerk-auth.guard.ts:canActivate',message:'Auth guard invoked',data:{hasAuthHeader:!!authHeader,authHeaderPrefix:authHeader?.slice(0,15),secretKeySet:!!this.configService.get('CLERK_SECRET_KEY'),url:request.url},timestamp:Date.now(),hypothesisId:'A-B'})}).catch(()=>{});
    // #endregion

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No authorization header found');
    }

    const token = authHeader.split(' ')[1];

    try {
      const sessionClaims = await this.clerkClient.verifyToken(token);
      request.user = sessionClaims;
      return true;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'clerk-auth.guard.ts:verifyToken-catch',message:'Clerk verify failed',data:{error:String(error)},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.error('Clerk verification error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
