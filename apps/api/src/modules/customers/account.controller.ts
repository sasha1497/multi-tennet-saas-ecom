import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TokenAudience } from '@retailos/types';
import {
  createAddressSchema,
  createReviewSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
  wishlistItemSchema,
} from '@retailos/validation';
import { Audience, RequireTenant } from '@/common/decorators';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ReviewsService } from '@/modules/reviews/reviews.service';
import { CustomersService } from './customers.service';

class UpdateProfileDto extends createZodDto(updateCustomerProfileSchema) {}
class CreateAddressDto extends createZodDto(createAddressSchema) {}
class UpdateAddressDto extends createZodDto(updateAddressSchema) {}
class WishlistDto extends createZodDto(wishlistItemSchema) {}
class CreateReviewDto extends createZodDto(createReviewSchema) {}
class PushTokenDto extends createZodDto(
  z.object({
    token: z.string().min(10).max(512),
    platform: z.enum(['ios', 'android', 'web']),
    deviceId: z.string().max(128).optional(),
  }),
) {}

/**
 * Signed-in shopper's account: profile, addresses, wishlist, reviews and the
 * in-app notification inbox.
 */
@ApiTags('Customer account')
@Controller()
@Audience(TokenAudience.CUSTOMER)
@RequireTenant()
export class AccountController {
  constructor(
    private readonly customers: CustomersService,
    private readonly reviews: ReviewsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Your profile' })
  profile() {
    return this.customers.getOwnProfile();
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your profile' })
  updateProfile(@Body() dto: UpdateProfileDto) {
    return this.customers.updateOwnProfile(dto);
  }

  // ------------------------------------------------------------ addresses --

  @Get('addresses')
  @ApiOperation({ summary: 'Your saved addresses' })
  addresses() {
    return this.customers.listAddresses();
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Save a new address' })
  createAddress(@Body() dto: CreateAddressDto) {
    return this.customers.createAddress(dto);
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Update a saved address' })
  updateAddress(@Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.customers.updateAddress(id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved address' })
  async deleteAddress(@Param('id') id: string): Promise<void> {
    await this.customers.deleteAddress(id);
  }

  // ------------------------------------------------------------- wishlist --

  @Get('wishlist')
  @ApiOperation({ summary: 'Your wishlist' })
  wishlist() {
    return this.customers.listWishlist();
  }

  @Post('wishlist')
  @ApiOperation({ summary: 'Add a product to your wishlist' })
  addToWishlist(@Body() dto: WishlistDto) {
    return this.customers.addToWishlist(dto.productId);
  }

  @Delete('wishlist/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a product from your wishlist' })
  async removeFromWishlist(@Param('productId') productId: string): Promise<void> {
    await this.customers.removeFromWishlist(productId);
  }

  // -------------------------------------------------------------- reviews --

  @Post('reviews')
  @ApiOperation({
    summary: 'Write a product review',
    description: 'Reviews are held for merchant approval before appearing on the storefront.',
  })
  createReview(@Body() dto: CreateReviewDto) {
    return this.reviews.create(dto);
  }

  // -------------------------------------------------------- notifications --

  @Get('notifications')
  @ApiOperation({ summary: 'Your in-app notifications' })
  notificationsList() {
    return this.notifications.listForCustomer();
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Param('id') id: string): Promise<void> {
    await this.notifications.markRead(id);
  }

  @Post('notifications/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register a device for push notifications' })
  async registerPushToken(@Body() dto: PushTokenDto): Promise<void> {
    await this.notifications.registerPushToken(dto.token, dto.platform, dto.deviceId);
  }
}
