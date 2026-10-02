/**
 * Demo dataset for local development.
 *
 * Realistic Indian local-retail data rather than "Product 1 / Product 2": the
 * storefront and dashboard only look right — and design problems only show up —
 * with plausible names, prices and stock levels.
 *
 * All prices are in paise.
 */

export interface SeedVariant {
  sku: string;
  options: Record<string, string>;
  price: number;
  mrp: number;
  stock: number;
}

export interface SeedProduct {
  name: string;
  shortDescription: string;
  description: string;
  category: string;
  brand: string;
  tags: string[];
  featured?: boolean;
  image: string;
  options: { name: string; values: string[] }[];
  variants: SeedVariant[];
}

export interface SeedTenant {
  slug: string;
  name: string;
  businessCategory: string;
  owner: { firstName: string; lastName: string; email: string; phone: string };
  plan: string;
  tagline: string;
  theme: { primaryColor: string; accentColor: string };
  categories: { name: string; icon: string }[];
  brands: string[];
  products: SeedProduct[];
  customers: { firstName: string; lastName: string; email: string; phone: string }[];
}

/**
 * Deterministic placeholder imagery.
 *
 * `picsum.photos` with a stable seed gives every product the *same* picture on
 * every reseed, so screenshots and visual diffs stay stable.
 */
const img = (seed: string) => `https://picsum.photos/seed/${seed}/800/800`;

export const SEED_TENANTS: SeedTenant[] = [
  {
    slug: 'kickzone',
    name: 'KickZone',
    businessCategory: 'Footwear',
    owner: {
      firstName: 'Arjun',
      lastName: 'Mehta',
      email: 'owner@kickzone.dev',
      phone: '9876543210',
    },
    plan: 'PRO',
    tagline: 'Street-ready footwear for every step',
    theme: { primaryColor: '#1f47e0', accentColor: '#f97316' },
    categories: [
      { name: 'Running', icon: 'footprints' },
      { name: 'Casual Sneakers', icon: 'shoe' },
      { name: 'Formal', icon: 'briefcase' },
      { name: 'Sandals & Slides', icon: 'sun' },
      { name: 'Kids', icon: 'baby' },
    ],
    brands: ['Velocity', 'StrideLab', 'UrbanFoot', 'Terra'],
    products: [
      {
        name: 'Velocity Pace 3 Running Shoes',
        shortDescription: 'Lightweight daily trainer with responsive cushioning',
        description:
          'The Pace 3 is built for everyday kilometres. A breathable engineered mesh upper keeps ' +
          'things cool, while the compression-moulded midsole returns energy on every stride. ' +
          'Reinforced heel counter for stability on long runs.',
        category: 'Running',
        brand: 'Velocity',
        tags: ['running', 'lightweight', 'daily trainer'],
        featured: true,
        image: img('kickzone-pace3'),
        options: [
          { name: 'Size', values: ['7', '8', '9', '10', '11'] },
          { name: 'Colour', values: ['Black/Volt', 'White/Blue'] },
        ],
        variants: [
          {
            sku: 'KZ-PACE3-7-BLK',
            options: { Size: '7', Colour: 'Black/Volt' },
            price: 419900,
            mrp: 549900,
            stock: 12,
          },
          {
            sku: 'KZ-PACE3-8-BLK',
            options: { Size: '8', Colour: 'Black/Volt' },
            price: 419900,
            mrp: 549900,
            stock: 18,
          },
          {
            sku: 'KZ-PACE3-9-BLK',
            options: { Size: '9', Colour: 'Black/Volt' },
            price: 419900,
            mrp: 549900,
            stock: 4,
          },
          {
            sku: 'KZ-PACE3-8-WHT',
            options: { Size: '8', Colour: 'White/Blue' },
            price: 439900,
            mrp: 549900,
            stock: 9,
          },
          {
            sku: 'KZ-PACE3-10-WHT',
            options: { Size: '10', Colour: 'White/Blue' },
            price: 439900,
            mrp: 549900,
            stock: 2,
          },
        ],
      },
      {
        name: 'StrideLab Court Classic',
        shortDescription: 'Timeless low-top sneaker in full-grain leather',
        description:
          'A clean court silhouette that works with jeans or chinos. Full-grain leather upper, ' +
          'padded collar and a vulcanised rubber outsole that only looks better with wear.',
        category: 'Casual Sneakers',
        brand: 'StrideLab',
        tags: ['sneakers', 'leather', 'everyday'],
        featured: true,
        image: img('kickzone-court'),
        options: [{ name: 'Size', values: ['7', '8', '9', '10'] }],
        variants: [
          { sku: 'KZ-COURT-7', options: { Size: '7' }, price: 289900, mrp: 349900, stock: 15 },
          { sku: 'KZ-COURT-8', options: { Size: '8' }, price: 289900, mrp: 349900, stock: 22 },
          { sku: 'KZ-COURT-9', options: { Size: '9' }, price: 289900, mrp: 349900, stock: 11 },
          { sku: 'KZ-COURT-10', options: { Size: '10' }, price: 289900, mrp: 349900, stock: 0 },
        ],
      },
      {
        name: 'UrbanFoot Oxford Brogue',
        shortDescription: 'Hand-finished leather brogue for formal occasions',
        description:
          'Goodyear-welted construction, full-grain calf leather and a leather sole with a ' +
          'rubber insert at the heel. Resoleable, so it will outlast several pairs of trainers.',
        category: 'Formal',
        brand: 'UrbanFoot',
        tags: ['formal', 'leather', 'office'],
        image: img('kickzone-brogue'),
        options: [{ name: 'Size', values: ['7', '8', '9', '10'] }],
        variants: [
          { sku: 'KZ-BROGUE-8', options: { Size: '8' }, price: 549900, mrp: 699900, stock: 6 },
          { sku: 'KZ-BROGUE-9', options: { Size: '9' }, price: 549900, mrp: 699900, stock: 8 },
          { sku: 'KZ-BROGUE-10', options: { Size: '10' }, price: 549900, mrp: 699900, stock: 3 },
        ],
      },
      {
        name: 'Terra Trail Sandal',
        shortDescription: 'Adjustable sandal with grippy trail outsole',
        description:
          'Three adjustable straps, a quick-dry footbed and a lugged outsole that handles wet ' +
          'rock. Comfortable enough for a full day of walking.',
        category: 'Sandals & Slides',
        brand: 'Terra',
        tags: ['sandal', 'outdoor', 'monsoon'],
        image: img('kickzone-sandal'),
        options: [{ name: 'Size', values: ['7', '8', '9', '10'] }],
        variants: [
          { sku: 'KZ-TRAIL-8', options: { Size: '8' }, price: 179900, mrp: 229900, stock: 25 },
          { sku: 'KZ-TRAIL-9', options: { Size: '9' }, price: 179900, mrp: 229900, stock: 19 },
          { sku: 'KZ-TRAIL-10', options: { Size: '10' }, price: 179900, mrp: 229900, stock: 14 },
        ],
      },
      {
        name: 'Velocity Junior Sprint',
        shortDescription: 'Velcro running shoe for kids aged 5-10',
        description:
          'Easy velcro closure so kids can put them on themselves. Flexible sole, washable ' +
          'upper and a reflective strip for evening visibility.',
        category: 'Kids',
        brand: 'Velocity',
        tags: ['kids', 'velcro', 'school'],
        featured: true,
        image: img('kickzone-junior'),
        options: [
          { name: 'Size', values: ['1', '2', '3', '4'] },
          { name: 'Colour', values: ['Red', 'Blue'] },
        ],
        variants: [
          {
            sku: 'KZ-JR-1-RED',
            options: { Size: '1', Colour: 'Red' },
            price: 149900,
            mrp: 199900,
            stock: 20,
          },
          {
            sku: 'KZ-JR-2-RED',
            options: { Size: '2', Colour: 'Red' },
            price: 149900,
            mrp: 199900,
            stock: 17,
          },
          {
            sku: 'KZ-JR-2-BLU',
            options: { Size: '2', Colour: 'Blue' },
            price: 149900,
            mrp: 199900,
            stock: 5,
          },
          {
            sku: 'KZ-JR-3-BLU',
            options: { Size: '3', Colour: 'Blue' },
            price: 159900,
            mrp: 199900,
            stock: 13,
          },
        ],
      },
      {
        name: 'StrideLab Canvas Slip-On',
        shortDescription: 'Easy canvas slip-on for warm days',
        description: 'Breathable cotton canvas, elastic side panels and a cushioned insole.',
        category: 'Casual Sneakers',
        brand: 'StrideLab',
        tags: ['canvas', 'summer', 'slip-on'],
        image: img('kickzone-slipon'),
        options: [{ name: 'Size', values: ['7', '8', '9'] }],
        variants: [
          { sku: 'KZ-SLIP-7', options: { Size: '7' }, price: 129900, mrp: 179900, stock: 30 },
          { sku: 'KZ-SLIP-8', options: { Size: '8' }, price: 129900, mrp: 179900, stock: 28 },
          { sku: 'KZ-SLIP-9', options: { Size: '9' }, price: 129900, mrp: 179900, stock: 7 },
        ],
      },
    ],
    customers: [
      { firstName: 'Priya', lastName: 'Sharma', email: 'priya@example.com', phone: '9811111111' },
      { firstName: 'Rahul', lastName: 'Verma', email: 'rahul@example.com', phone: '9822222222' },
      { firstName: 'Ananya', lastName: 'Iyer', email: 'ananya@example.com', phone: '9833333333' },
    ],
  },

  {
    slug: 'abcstore',
    name: 'ABC Store',
    businessCategory: 'General Retail',
    owner: {
      firstName: 'Sunita',
      lastName: 'Rao',
      email: 'owner@abcstore.dev',
      phone: '9876543211',
    },
    plan: 'STARTER',
    tagline: 'Your neighbourhood essentials, delivered',
    theme: { primaryColor: '#0f766e', accentColor: '#f59e0b' },
    categories: [
      { name: 'Home & Kitchen', icon: 'home' },
      { name: 'Stationery', icon: 'pencil' },
      { name: 'Personal Care', icon: 'sparkles' },
      { name: 'Snacks', icon: 'cookie' },
    ],
    brands: ['HomeCraft', 'InkWell', 'PureDay'],
    products: [
      {
        name: 'HomeCraft Steel Tiffin Set (3 Tier)',
        shortDescription: 'Leak-proof stainless steel lunch box',
        description:
          'Three stacking containers in food-grade stainless steel with a locking clamp. ' +
          'Keeps food warm for about four hours and fits a standard lunch bag.',
        category: 'Home & Kitchen',
        brand: 'HomeCraft',
        tags: ['tiffin', 'steel', 'lunch'],
        featured: true,
        image: img('abc-tiffin'),
        options: [{ name: 'Capacity', values: ['750ml', '1000ml'] }],
        variants: [
          {
            sku: 'ABC-TIF-750',
            options: { Capacity: '750ml' },
            price: 64900,
            mrp: 89900,
            stock: 40,
          },
          {
            sku: 'ABC-TIF-1000',
            options: { Capacity: '1000ml' },
            price: 79900,
            mrp: 109900,
            stock: 26,
          },
        ],
      },
      {
        name: 'InkWell Gel Pen Pack (Pack of 10)',
        shortDescription: 'Smooth 0.7mm gel pens in blue',
        description: 'Quick-drying ink, comfortable rubber grip and a consistent 0.7mm line.',
        category: 'Stationery',
        brand: 'InkWell',
        tags: ['pens', 'school', 'office'],
        featured: true,
        image: img('abc-pens'),
        options: [{ name: 'Colour', values: ['Blue', 'Black'] }],
        variants: [
          { sku: 'ABC-PEN-BLU', options: { Colour: 'Blue' }, price: 19900, mrp: 25000, stock: 120 },
          { sku: 'ABC-PEN-BLK', options: { Colour: 'Black' }, price: 19900, mrp: 25000, stock: 95 },
        ],
      },
      {
        name: 'PureDay Aloe Face Wash 150ml',
        shortDescription: 'Gentle daily cleanser with aloe vera',
        description: 'Soap-free formulation suitable for daily use on sensitive skin.',
        category: 'Personal Care',
        brand: 'PureDay',
        tags: ['skincare', 'daily'],
        image: img('abc-facewash'),
        options: [],
        variants: [{ sku: 'ABC-FW-150', options: {}, price: 24900, mrp: 32000, stock: 60 }],
      },
      {
        name: 'HomeCraft Non-Stick Tawa 28cm',
        shortDescription: 'Even-heating tawa with a stay-cool handle',
        description:
          'Heavy-gauge aluminium with a three-layer non-stick coating. Works on gas and ' +
          'induction. Hand wash recommended.',
        category: 'Home & Kitchen',
        brand: 'HomeCraft',
        tags: ['cookware', 'kitchen'],
        image: img('abc-tawa'),
        options: [],
        variants: [{ sku: 'ABC-TAWA-28', options: {}, price: 89900, mrp: 129900, stock: 3 }],
      },
      {
        name: 'InkWell A4 Notebook (200 pages)',
        shortDescription: 'Ruled notebook with a hard cover',
        description: '70 GSM paper, stitched binding and a wipe-clean hard cover.',
        category: 'Stationery',
        brand: 'InkWell',
        tags: ['notebook', 'school'],
        image: img('abc-notebook'),
        options: [{ name: 'Ruling', values: ['Ruled', 'Plain'] }],
        variants: [
          { sku: 'ABC-NB-RUL', options: { Ruling: 'Ruled' }, price: 12900, mrp: 16000, stock: 80 },
          { sku: 'ABC-NB-PLN', options: { Ruling: 'Plain' }, price: 12900, mrp: 16000, stock: 45 },
        ],
      },
    ],
    customers: [
      { firstName: 'Vikram', lastName: 'Nair', email: 'vikram@example.com', phone: '9844444444' },
      { firstName: 'Meera', lastName: 'Joshi', email: 'meera@example.com', phone: '9855555555' },
    ],
  },

  {
    slug: 'kumarstore',
    name: 'Kumar Mobile Store',
    businessCategory: 'Mobile Shop',
    owner: {
      firstName: 'Rajesh',
      lastName: 'Kumar',
      email: 'owner@kumarstore.dev',
      phone: '9876543212',
    },
    plan: 'GROWTH',
    tagline: 'Phones, accessories and honest advice',
    theme: { primaryColor: '#7c3aed', accentColor: '#ec4899' },
    categories: [
      { name: 'Smartphones', icon: 'smartphone' },
      { name: 'Audio', icon: 'headphones' },
      { name: 'Chargers & Cables', icon: 'plug' },
      { name: 'Cases & Covers', icon: 'shield' },
    ],
    brands: ['Nova', 'SoundPeak', 'ChargeUp'],
    products: [
      {
        name: 'Nova N12 5G (8GB / 128GB)',
        shortDescription: '6.6" 120Hz display, 50MP camera, 5000mAh',
        description:
          '5G-ready mid-ranger with a 120Hz AMOLED display, a 50MP main camera with OIS and a ' +
          '5000mAh battery that comfortably lasts a day. Includes a 33W charger in the box.',
        category: 'Smartphones',
        brand: 'Nova',
        tags: ['5g', 'smartphone', 'amoled'],
        featured: true,
        image: img('kumar-n12'),
        options: [{ name: 'Colour', values: ['Midnight', 'Aurora'] }],
        variants: [
          {
            sku: 'KM-N12-MID',
            options: { Colour: 'Midnight' },
            price: 1699900,
            mrp: 1999900,
            stock: 7,
          },
          {
            sku: 'KM-N12-AUR',
            options: { Colour: 'Aurora' },
            price: 1699900,
            mrp: 1999900,
            stock: 4,
          },
        ],
      },
      {
        name: 'SoundPeak Buds Air 2',
        shortDescription: 'True wireless earbuds with 30-hour total playback',
        description:
          'Environmental noise cancellation for calls, low-latency gaming mode and a charging ' +
          'case that adds three full recharges.',
        category: 'Audio',
        brand: 'SoundPeak',
        tags: ['earbuds', 'wireless', 'tws'],
        featured: true,
        image: img('kumar-buds'),
        options: [{ name: 'Colour', values: ['White', 'Black'] }],
        variants: [
          {
            sku: 'KM-BUDS-WHT',
            options: { Colour: 'White' },
            price: 249900,
            mrp: 349900,
            stock: 18,
          },
          {
            sku: 'KM-BUDS-BLK',
            options: { Colour: 'Black' },
            price: 249900,
            mrp: 349900,
            stock: 2,
          },
        ],
      },
      {
        name: 'ChargeUp 33W Fast Charger',
        shortDescription: 'USB-C fast charger with cable included',
        description: 'Supports PD 3.0 and QC 4+. Compact folding pin design.',
        category: 'Chargers & Cables',
        brand: 'ChargeUp',
        tags: ['charger', 'usb-c', 'fast charging'],
        image: img('kumar-charger'),
        options: [],
        variants: [{ sku: 'KM-CHG-33W', options: {}, price: 89900, mrp: 129900, stock: 35 }],
      },
      {
        name: 'Nova N12 Silicone Case',
        shortDescription: 'Slim protective case with raised camera lip',
        description: 'Soft-touch silicone with a microfibre lining and precise cutouts.',
        category: 'Cases & Covers',
        brand: 'Nova',
        tags: ['case', 'protection'],
        image: img('kumar-case'),
        options: [{ name: 'Colour', values: ['Black', 'Navy'] }],
        variants: [
          { sku: 'KM-CASE-BLK', options: { Colour: 'Black' }, price: 39900, mrp: 59900, stock: 50 },
          { sku: 'KM-CASE-NVY', options: { Colour: 'Navy' }, price: 39900, mrp: 59900, stock: 41 },
        ],
      },
    ],
    customers: [
      {
        firstName: 'Karthik',
        lastName: 'Reddy',
        email: 'karthik@example.com',
        phone: '9866666666',
      },
      { firstName: 'Divya', lastName: 'Menon', email: 'divya@example.com', phone: '9877777777' },
    ],
  },
];

/**
 * The plan catalogue — the one place prices and plan contents are defined.
 *
 * Seeding upserts by `code`, so re-running the seed reprices an existing
 * deployment in place; after that, a super admin edits plans in the platform
 * console and nothing in any frontend needs to change. Prices are minor units.
 *
 * Template access is granted per *family* (`templates_standard`, …), never per
 * template, so a template added to a family reaches every entitled store.
 *
 * FREE is not sold. It is the floor a lapsed subscription falls back to, and is
 * kept non-public. ENTERPRISE is non-public too: it exists for contracted
 * accounts and so no live store loses its plan row.
 */
const ALL_OFF = {
  products: true,
  orders: true,
  templates_standard: true,
  templates_premium: false,
  templates_3d: false,
  staff: false,
  coupons: false,
  reports: true,
  advanced_analytics: false,
  advanced_reports: false,
  advanced_inventory: false,
  crm: false,
  marketing: false,
  loyalty: false,
  push_notifications: false,
  delivery: false,
  custom_domain: false,
  pos: false,
  barcode: false,
  ai_product_upload: false,
  ai_assistant: false,
  multi_branch: false,
  white_label_app: false,
};

const STARTER_FEATURES = { ...ALL_OFF, ai_product_upload: true };

const GROWTH_FEATURES = {
  ...STARTER_FEATURES,
  templates_premium: true,
  staff: true,
  coupons: true,
  advanced_analytics: true,
  advanced_inventory: true,
  crm: true,
  marketing: true,
  loyalty: true,
  push_notifications: true,
  delivery: true,
};

const PRO_FEATURES = {
  ...GROWTH_FEATURES,
  templates_3d: true,
  advanced_reports: true,
  custom_domain: true,
  pos: true,
  barcode: true,
  ai_assistant: true,
};

export const SEED_PLANS = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'The floor a store falls back to when its subscription lapses.',
    priceMonthly: 0,
    priceYearly: 0,
    trialDays: 0,
    sortOrder: 0,
    isPublic: false,
    features: ALL_OFF,
    limits: {
      max_products: 25,
      max_staff: 1,
      max_orders_per_month: 100,
      max_storage_mb: 100,
      ai_generations_per_month: 0,
    },
  },
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Your shop online with six fast, clean storefront designs.',
    priceMonthly: 29900,
    priceYearly: 299000,
    trialDays: 14,
    sortOrder: 1,
    isPublic: true,
    features: STARTER_FEATURES,
    limits: {
      max_products: 250,
      max_staff: 1,
      max_orders_per_month: 1000,
      max_storage_mb: 1000,
      ai_generations_per_month: 10,
    },
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    description: 'Every premium design, a team, coupons, CRM and marketing.',
    priceMonthly: 59900,
    priceYearly: 599000,
    trialDays: 14,
    sortOrder: 2,
    isPublic: true,
    features: GROWTH_FEATURES,
    limits: {
      max_products: 2000,
      max_staff: 5,
      max_orders_per_month: 10000,
      max_storage_mb: 5000,
      ai_generations_per_month: 50,
    },
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: '3D storefronts, POS and barcode, advanced reports and the AI assistant.',
    priceMonthly: 99900,
    priceYearly: 999000,
    trialDays: 14,
    sortOrder: 3,
    isPublic: true,
    features: PRO_FEATURES,
    limits: {
      max_products: 10000,
      max_staff: 10,
      max_orders_per_month: 50000,
      max_storage_mb: 20000,
      ai_generations_per_month: 200,
    },
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Contracted accounts: everything, unmetered, with multi-branch.',
    priceMonthly: 499900,
    priceYearly: 4999900,
    trialDays: 0,
    sortOrder: 4,
    isPublic: false,
    features: Object.fromEntries(Object.keys(ALL_OFF).map((k) => [k, true])),
    limits: {
      max_products: -1,
      max_staff: -1,
      max_orders_per_month: -1,
      max_storage_mb: -1,
      // AI is metered on every plan; a contract sets its own number.
      ai_generations_per_month: 1000,
    },
  },
];

export const SEED_COUPONS = [
  {
    code: 'WELCOME10',
    description: '10% off your first order',
    discountType: 'PERCENTAGE' as const,
    discountValue: 10,
    maxDiscountAmount: 50000,
    minOrderAmount: 100000,
    perCustomerLimit: 1,
  },
  {
    code: 'FLAT200',
    description: '₹200 off orders above ₹1,500',
    discountType: 'FIXED' as const,
    discountValue: 20000,
    maxDiscountAmount: null,
    minOrderAmount: 150000,
    perCustomerLimit: null,
  },
];
