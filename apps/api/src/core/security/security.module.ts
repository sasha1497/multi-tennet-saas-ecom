import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '@/config/config.module';
import { CredentialCipherService, TokenHasher } from './credential-cipher.service';
import { PasswordService } from './password.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [PasswordService, CredentialCipherService, TokenHasher],
  exports: [PasswordService, CredentialCipherService, TokenHasher],
})
export class SecurityModule {}
