import { ORDER_STATUS_TRANSITIONS, OrderStatus, Role } from './enums';
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_STAFF_ROLES,
  Permission,
  ROLE_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  permissionsForRole,
} from './permissions';

describe('role permissions', () => {
  it('gives SUPER_ADMIN everything', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.length).toBe(ALL_PERMISSIONS.length);
  });

  it('gives CUSTOMER no console permissions at all', () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toHaveLength(0);
  });

  /**
   * The platform boundary: no merchant role may hold a `platform.*` permission,
   * or a store owner could reach the fleet-wide console.
   */
  it('keeps platform permissions out of every merchant role', () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF'] as const) {
      const platformish = ROLE_PERMISSIONS[role].filter((p) => p.startsWith('platform.'));
      expect(platformish).toHaveLength(0);
    }
  });

  it('orders merchant roles from most to least privileged', () => {
    expect(ROLE_PERMISSIONS.OWNER.length).toBeGreaterThan(ROLE_PERMISSIONS.MANAGER.length);
    expect(ROLE_PERMISSIONS.MANAGER.length).toBeGreaterThan(ROLE_PERMISSIONS.STAFF.length);
  });

  it('reserves team management for the owner', () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain(Permission.STAFF_MANAGE);
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain(Permission.STAFF_MANAGE);
    expect(ROLE_PERMISSIONS.STAFF).not.toContain(Permission.STAFF_MANAGE);
  });

  it('reserves refunds for owner-level access', () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain(Permission.ORDERS_REFUND);
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain(Permission.ORDERS_REFUND);
  });

  it('does not let a merchant assign OWNER or SUPER_ADMIN to staff', () => {
    expect(ASSIGNABLE_STAFF_ROLES).toEqual([Role.MANAGER, Role.STAFF]);
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain(Role.OWNER);
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain(Role.SUPER_ADMIN);
  });
});

describe('permissionsForRole', () => {
  it('returns the role defaults', () => {
    expect(permissionsForRole(Role.STAFF)).toEqual(
      expect.arrayContaining([Permission.ORDERS_READ]),
    );
  });

  it('merges extra grants without duplicating', () => {
    const result = permissionsForRole(Role.STAFF, [
      Permission.ORDERS_REFUND,
      Permission.ORDERS_READ, // already in the role
    ]);
    expect(result).toContain(Permission.ORDERS_REFUND);
    expect(result.filter((p) => p === Permission.ORDERS_READ)).toHaveLength(1);
  });
});

describe('hasPermission', () => {
  it('requires every listed permission', () => {
    const granted = [Permission.ORDERS_READ, Permission.ORDERS_UPDATE];
    expect(hasPermission(granted, Permission.ORDERS_READ)).toBe(true);
    expect(hasPermission(granted, [Permission.ORDERS_READ, Permission.ORDERS_UPDATE])).toBe(true);
    expect(hasPermission(granted, [Permission.ORDERS_READ, Permission.ORDERS_REFUND])).toBe(false);
  });

  it('requires at least one for hasAnyPermission', () => {
    const granted = [Permission.ORDERS_READ];
    expect(hasAnyPermission(granted, [Permission.ORDERS_READ, Permission.ORDERS_REFUND])).toBe(true);
    expect(hasAnyPermission(granted, [Permission.STAFF_MANAGE])).toBe(false);
  });

  it('treats an empty grant list as no access', () => {
    expect(hasPermission([], Permission.ORDERS_READ)).toBe(false);
  });
});

describe('order status transitions', () => {
  it('defines a transition list for every status', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('allows the normal fulfilment path', () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING).toContain('CONFIRMED');
    expect(ORDER_STATUS_TRANSITIONS.CONFIRMED).toContain('PROCESSING');
    expect(ORDER_STATUS_TRANSITIONS.PROCESSING).toContain('SHIPPED');
    expect(ORDER_STATUS_TRANSITIONS.SHIPPED).toContain('OUT_FOR_DELIVERY');
    expect(ORDER_STATUS_TRANSITIONS.OUT_FOR_DELIVERY).toContain('DELIVERED');
  });

  /** The reason the map exists: no skipping straight to delivered. */
  it('forbids jumping from PENDING to DELIVERED', () => {
    expect(ORDER_STATUS_TRANSITIONS.PENDING).not.toContain('DELIVERED');
  });

  it('forbids reviving a refunded order', () => {
    expect(ORDER_STATUS_TRANSITIONS.REFUNDED).toHaveLength(0);
  });

  it('forbids un-cancelling an order', () => {
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).not.toContain('CONFIRMED');
    expect(ORDER_STATUS_TRANSITIONS.CANCELLED).toEqual(['REFUNDED']);
  });

  it('allows cancelling from any pre-delivery status', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'] as const) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toContain('CANCELLED');
    }
  });

  it('never contains a self-transition', () => {
    for (const [from, targets] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });
});
