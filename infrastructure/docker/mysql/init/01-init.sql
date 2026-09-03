-- ---------------------------------------------------------------------------
-- MySQL compatibility database.
--
-- MySQL is a SECONDARY service in RetailOS. PostgreSQL is the primary store for
-- both the master (control-plane) database and every tenant database — see
-- docs/DATABASE.md §"Why PostgreSQL is primary and what MySQL is for".
--
-- This schema exists so MySQL-backed work has a real, running service to
-- develop against without touching core domain data:
--   • importing catalogues from legacy Indian retail/billing software, which is
--     overwhelmingly MySQL-based
--   • staging area for data migrations onto the platform
--   • a landing zone for future optional modules that ship with MySQL storage
--
-- Nothing in the core application reads or writes these tables.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS retailos_compat
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE retailos_compat;

-- Staging table for a legacy product import. A job would read from here,
-- validate, and write into the tenant's PostgreSQL catalog.
CREATE TABLE IF NOT EXISTS legacy_product_import (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_slug    VARCHAR(63)   NOT NULL,
  source_system  VARCHAR(64)   NOT NULL,
  external_id    VARCHAR(128)  NOT NULL,
  name           VARCHAR(255)  NOT NULL,
  sku            VARCHAR(64)   NULL,
  barcode        VARCHAR(64)   NULL,
  category_name  VARCHAR(120)  NULL,
  brand_name     VARCHAR(120)  NULL,
  -- Minor units, matching the platform's money convention.
  price_minor    BIGINT        NOT NULL DEFAULT 0,
  mrp_minor      BIGINT        NOT NULL DEFAULT 0,
  stock_quantity INT           NOT NULL DEFAULT 0,
  raw_payload    JSON          NULL,
  status         ENUM('PENDING','IMPORTED','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  error_message  TEXT          NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   TIMESTAMP     NULL,
  UNIQUE KEY uq_import_source (tenant_slug, source_system, external_id),
  KEY idx_import_status (status, created_at)
) ENGINE=InnoDB;

-- Mirrors the platform's tenant registry for reporting tools that only speak
-- MySQL. Populated by an optional sync job; never authoritative.
CREATE TABLE IF NOT EXISTS tenant_directory_mirror (
  tenant_id     CHAR(36)     PRIMARY KEY,
  slug          VARCHAR(63)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  status        VARCHAR(24)  NOT NULL,
  plan_code     VARCHAR(32)  NULL,
  synced_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mirror_slug (slug)
) ENGINE=InnoDB;

-- Simple health/connectivity marker so `docker compose` users can confirm the
-- service is genuinely reachable and writable.
CREATE TABLE IF NOT EXISTS compat_healthcheck (
  id         TINYINT PRIMARY KEY DEFAULT 1,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO compat_healthcheck (id) VALUES (1)
  ON DUPLICATE KEY UPDATE checked_at = CURRENT_TIMESTAMP;
