import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Global because `JwtAuthGuard` (registered app-wide) needs `JwtService`, and
 * several modules mint tokens — staff invites, for example.
 */
@Global()
@Module({
  imports: [
    AppConfigModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // Secrets are passed per-signature instead of globally: access and
        // refresh tokens are signed with *different* keys, so a leaked access
        // secret cannot be used to mint refresh tokens.
        signOptions: { issuer: config.auth.issuer },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}
