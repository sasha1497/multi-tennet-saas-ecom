import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { HEADERS } from '@retailos/config';
import { TokenAudience } from '@retailos/types';
import { addCartItemSchema, applyCouponSchema, updateCartItemSchema } from '@retailos/validation';
import { Audience, Public, RequireTenant } from '@/common/decorators';
import { RequestContextService } from '@/core/context/request-context';
import { CartService } from './cart.service';

class AddCartItemDto extends createZodDto(addCartItemSchema) {}
class UpdateCartItemDto extends createZodDto(updateCartItemSchema) {}
class ApplyCouponDto extends createZodDto(applyCouponSchema) {}

/**
 * Cart endpoints.
 *
 * Anonymous shopping is supported: a signed guest token identifies the cart and
 * is minted here on first write, returned in the `X-Guest-Token` response header
 * for the client to persist. Because it is HMAC-signed, a guest cannot guess
 * another guest's cart id.
 */
@ApiTags('Cart')
@Controller('cart')
@Public()
@RequireTenant()
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly context: RequestContextService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current cart with live prices, totals and any blocking issues' })
  get() {
    return this.cart.get();
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a variant to the cart' })
  add(@Body() dto: AddCartItemDto, @Res({ passthrough: true }) res: Response) {
    this.ensureGuestSession(res);
    return this.cart.addItem(dto.variantId, dto.quantity);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Change a line quantity (0 removes the line)' })
  update(@Param('id') id: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.updateItem(id, dto.quantity);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a line from the cart' })
  remove(@Param('id') id: string) {
    return this.cart.removeItem(id);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the cart' })
  clear() {
    return this.cart.clear();
  }

  @Post('coupon')
  @ApiOperation({ summary: 'Apply a coupon code' })
  applyCoupon(@Body() dto: ApplyCouponDto) {
    return this.cart.applyCoupon(dto.code);
  }

  @Delete('coupon')
  @ApiOperation({ summary: 'Remove the applied coupon' })
  removeCoupon() {
    return this.cart.removeCoupon();
  }

  @Post('merge')
  @Audience(TokenAudience.CUSTOMER)
  @ApiOperation({
    summary: 'Merge the anonymous cart into the signed-in customer cart',
    description: 'Called by the storefront immediately after a successful sign-in.',
  })
  merge() {
    return this.cart.mergeGuestCart();
  }

  /**
   * Issues a guest token when an anonymous shopper writes to the cart for the
   * first time. Done in the controller so the header is on the response even
   * though the service works purely from the request context.
   */
  private ensureGuestSession(res: Response): void {
    if (this.context.auth?.audience === 'customer') return;
    if (this.context.guestToken) return;

    const token = this.cart.issueGuestToken();
    this.context.setGuestToken(token);
    res.setHeader(HEADERS.GUEST_TOKEN, token);
  }
}
