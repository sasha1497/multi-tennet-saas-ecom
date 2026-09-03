import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { TokenAudience } from '@retailos/types';
import { cancelOrderSchema, createOrderSchema, orderQuerySchema } from '@retailos/validation';
import { Audience, RequireTenant } from '@/common/decorators';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { OrdersService } from './orders.service';

class CreateOrderDto extends createZodDto(createOrderSchema) {}
class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
class OrderQueryDto extends createZodDto(orderQuerySchema) {}

/**
 * Shopper-facing order endpoints.
 *
 * Every read is scoped to the authenticated customer inside the service, so
 * guessing another shopper's order id returns 404 rather than their address.
 */
@ApiTags('Orders (customer)')
@Controller('orders')
@Audience(TokenAudience.CUSTOMER)
@RequireTenant()
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RateLimit({ limit: 20, ttl: 300, bucket: 'checkout', by: 'user' })
  @ApiOperation({
    summary: 'Place an order',
    description:
      'Validates prices and stock, reserves inventory, snapshots the line items and creates ' +
      'the payment intent — all in one transaction. Send a stable `idempotencyKey`: replaying ' +
      'it returns the original order instead of creating a duplicate.',
  })
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Your order history' })
  list(@Query() query: OrderQueryDto) {
    return this.orders.listForCustomer(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of your orders in full' })
  get(@Param('id') id: string) {
    return this.orders.findByIdForCustomer(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order',
    description: 'Allowed while the order is still pending, confirmed or being processed.',
  })
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByCustomer(id, dto.reason);
  }

  @Get(':orderNumber/tracking')
  @ApiOperation({ summary: 'Delivery timeline for an order' })
  tracking(@Param('orderNumber') orderNumber: string) {
    return this.orders.tracking(orderNumber);
  }
}
