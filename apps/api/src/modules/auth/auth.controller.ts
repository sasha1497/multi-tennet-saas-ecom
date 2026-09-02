import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TokenAudience } from '@retailos/types';
import {
  Audience,
  CurrentUser,
  Public,
  RequireTenant,
} from '@/common/decorators';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { AppConfigService } from '@/config/config.module';
import { RequestContextService } from '@/core/context/request-context';
import type { AuthContextData } from '@/core/context/request-context';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  CheckSlugDto,
  CustomerLoginDto,
  LoginDto,
  RefreshDto,
  RegisterCustomerDto,
  RegisterMerchantDto,
  SwitchTenantDto,
} from './auth.dto';

/**
 * Authentication endpoints.
 *
 * Two distinct audiences share this controller but never share a token:
 *   • `/auth/*`           — merchant + platform console (master DB identity)
 *   • `/auth/customer/*`  — shoppers (tenant DB identity, tenant from the Host)
 *
 * Every credential-accepting route is rate limited by IP; brute-forcing one
 * account across many IPs still runs into the per-account progressive lockout.
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly context: RequestContextService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------- merchant / platform --

  @Post('register')
  @Public()
  @RateLimit({ limit: 5, ttl: 3600, bucket: 'auth:register', by: 'ip' })
  @ApiOperation({
    summary: 'Register a merchant and create their store',
    description:
      'Creates the platform user, reserves the subdomain and queues tenant provisioning. ' +
      'Returns immediately — the store becomes reachable once provisioning completes.',
  })
  register(@Body() dto: RegisterMerchantDto) {
    return this.auth.registerMerchant(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, ttl: 300, bucket: 'auth:login', by: 'ip' })
  @ApiOperation({ summary: 'Sign in to the merchant or platform console' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @Audience(TokenAudience.ADMIN)
  @ApiOperation({ summary: 'Current console session, memberships and permissions' })
  me(@CurrentUser() user: AuthContextData) {
    return this.auth.adminSession(user.userId, user.tokenTenantId);
  }

  @Post('switch-tenant')
  @Audience(TokenAudience.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-issue tokens scoped to another store the user belongs to',
  })
  switchTenant(@CurrentUser() user: AuthContextData, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(user.userId, dto.tenantId);
  }

  @Get('check-slug')
  @Public()
  @RateLimit({ limit: 60, ttl: 60, bucket: 'auth:slug', by: 'ip' })
  @ApiOperation({ summary: 'Check whether a store address is available' })
  checkSlug(@Query() query: CheckSlugDto) {
    return this.auth.checkSlug(query.slug);
  }

  // ------------------------------------------------------------ customer --

  @Post('customer/register')
  @Public()
  @RequireTenant()
  @RateLimit({ limit: 10, ttl: 3600, bucket: 'auth:customer-register', by: 'ip+tenant' })
  @ApiOperation({ summary: 'Create a shopper account for the current store' })
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.auth.registerCustomer(this.context.requireTenantId(), dto);
  }

  @Post('customer/login')
  @Public()
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, ttl: 300, bucket: 'auth:customer-login', by: 'ip+tenant' })
  @ApiOperation({ summary: 'Sign in as a shopper of the current store' })
  loginCustomer(@Body() dto: CustomerLoginDto) {
    return this.auth.loginCustomer(this.context.requireTenantId(), dto);
  }

  @Get('customer/me')
  @Audience(TokenAudience.CUSTOMER)
  @RequireTenant()
  @ApiOperation({ summary: 'Current shopper profile' })
  async customerMe(@CurrentUser() user: AuthContextData) {
    const tenant = this.context.requireTenant();
    const customer = await this.auth.customerProfile(tenant.tenantId, user.userId);
    return { customer, tenantId: tenant.tenantId, tenantSlug: tenant.slug };
  }

  // -------------------------------------------------------------- shared --

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, ttl: 300, bucket: 'auth:refresh', by: 'ip' })
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Refresh tokens rotate on every use. Presenting a superseded token revokes the ' +
      'whole session family and forces a fresh sign-in.',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of the current device' })
  async logout(): Promise<void> {
    await this.auth.logout();
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 5, ttl: 900, bucket: 'auth:change-password', by: 'user' })
  @ApiOperation({
    summary: 'Change the current password',
    description: 'Signs out every other device on success.',
  })
  async changePassword(@Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(dto.currentPassword, dto.newPassword);
  }
}
