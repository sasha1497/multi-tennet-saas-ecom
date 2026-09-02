import { createZodDto } from 'nestjs-zod';
import {
  changePasswordSchema,
  checkSlugSchema,
  customerLoginSchema,
  loginSchema,
  refreshSchema,
  registerCustomerSchema,
  registerMerchantSchema,
  switchTenantSchema,
} from '@retailos/validation';

/**
 * DTOs are thin wrappers over the shared Zod schemas in `@retailos/validation`.
 *
 * The point is that the API, both web apps and the mobile app validate against
 * *the same* rules — and, thanks to `nestjs-zod`, the OpenAPI document is
 * generated from those same schemas, so the docs cannot drift from the
 * validation either.
 */
export class LoginDto extends createZodDto(loginSchema) {}
export class RegisterMerchantDto extends createZodDto(registerMerchantSchema) {}
export class RegisterCustomerDto extends createZodDto(registerCustomerSchema) {}
export class CustomerLoginDto extends createZodDto(customerLoginSchema) {}
export class RefreshDto extends createZodDto(refreshSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class CheckSlugDto extends createZodDto(checkSlugSchema) {}
export class SwitchTenantDto extends createZodDto(switchTenantSchema) {}
