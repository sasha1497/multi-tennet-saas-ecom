# Storage

Every file a user uploads lives in object storage. MinIO locally, S3 (or any
S3-compatible service) in production. The application filesystem is never the
source of truth for anything a merchant uploaded, and there is no supported
configuration in which it is.

That is not a preference. A container filesystem is not shared between
replicas, does not survive a rebuild, and cannot be presigned — so a merchant's
product photograph would exist on exactly one of three API instances and vanish
on the next deploy.

---

## The shape of it

```
  browser ───── presigned PUT ─────────────────┐
     │                                          ▼
     │  1. POST /merchant/files/presign    ┌──────────┐
     ├─────────────────────────────────►   │ MinIO/S3 │
     │  2. PUT (direct, with signature)    └──────────┘
     │  3. POST /merchant/files/confirm         ▲
     ▼                                          │
  ┌─────┐   validates, signs, verifies          │
  │ API ├──────────────────────────────────────┘
  └──┬──┘
     │  stores bucket + key + metadata only
     ▼
  tenant database
```

The bytes never pass through the API. The database never holds an image.

---

## The abstraction

Business modules depend on `StorageService`. `StorageService` depends on the
`StorageProvider` port. Nothing outside `core/storage/providers` may import an
S3 or MinIO type — that is what lets the deployment target change without a
single edit in a business module.

|                                                    |                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `core/storage/storage.provider.ts`                 | The port. Put, get, ranged get, head, list, delete, delete-prefix, public URL, signed GET, signed PUT. |
| `core/storage/providers/s3-compatible.provider.ts` | One implementation. MinIO and S3 speak the same protocol; they differ in configuration, not behaviour. |
| `core/storage/providers/minio.provider.ts`         | Path-style addressing, explicit endpoint, static credentials.                                          |
| `core/storage/providers/s3.provider.ts`            | Virtual-host addressing, credentials optional so an IAM role can be used.                              |
| `core/storage/providers/local.provider.ts`         | Tests only. Cannot presign. Requires `STORAGE_ALLOW_LOCAL=true` and is refused in production.          |
| `core/storage/storage.service.ts`                  | The application-facing API. Validation, key construction, ownership enforcement.                       |
| `core/storage/media-url.service.ts`                | Turns stored object keys into URLs a browser can load.                                                 |

The provider is chosen once, by the factory in `storage.module.ts`, from
`STORAGE_PROVIDER`. There is deliberately no `if (isProd)` anywhere below it.

---

## Keys

```
tenants/<tenantId>/products/<productId>/<uuid>.webp
tenants/<tenantId>/store/<uuid>.png
tenants/<tenantId>/categories/<uuid>.jpg
```

Two properties matter:

- **The tenant segment** is what `assertOwnership` checks and what
  `purgeTenant` sweeps. Every method that takes a key also takes the acting
  tenant, and refuses keys belonging to anyone else. A tenant-prefixed key is
  only a convention until something enforces it; that check is the enforcement.
- **The product segment** makes deleting one product's media exact. No other
  product's files live under it, so removing a product never has to guess which
  objects were its own.

The uuid is full-length, not shortened. On a private bucket the key is the
entire secret protecting an object, so it must not be guessable from a
neighbour's.

Cross-tenant access answers `NOT_FOUND`, never `FORBIDDEN` — a 403 would
confirm the object exists, which is exactly what the caller was probing for.

---

## Uploading

### The direct path (preferred)

1. **`POST /merchant/files/presign`** — the client describes what it is about
   to upload. The API checks authentication, tenant, permissions, product
   ownership, file count, declared type, declared size, and that the extension
   and MIME type agree. It returns one presigned PUT per file.

2. **`PUT <uploadUrl>`** — the browser uploads straight to MinIO/S3, replaying
   the signed headers verbatim. `Content-Type` is part of the signature, so a
   ticket issued for a `.webp` cannot be redeemed for an HTML document at the
   object store.

3. **`POST /merchant/files/confirm`** — the API reads the object's _real_ size
   back from the store and sniffs its first 16 bytes against the type its key
   promised. Anything that fails is deleted from the bucket, so a rejected
   upload leaves nothing behind.

The client's claim that an upload succeeded is worth nothing on its own. Step 3
is why an issued ticket is a permission to write one key, not a product image.

### The multipart path

`POST /merchant/files/upload` still exists for clients that cannot do a direct
upload — the mobile app, mostly. Same validation, same keys; the bytes just go
through the API. Prefer the direct path.

---

## Previewing

The bucket is **private by default**, including in local development. A stored
key is therefore not directly fetchable, and the API mints a presigned GET for
it.

`MediaUrlService` does this in batches, once per response, rather than per
image — a 48-product grid signs its images in one pass instead of awaiting
inside a map. URLs are cached per key and reissued only once they are down to
half their validity, so:

- a client sees the same URL across renders, and the browser cache works;
- every URL handed out has at least `PRESIGNED_URL_EXPIRY / 2` remaining.

That second property is what makes it safe to put a presigned URL inside the
Redis catalogue cache. The API refuses to boot unless
`PRESIGNED_URL_EXPIRY / 2 > CACHE_TTL_CATALOG`, so a cached product page can
never outlive the image URLs inside it.

Setting `STORAGE_PUBLIC_READ=true` switches previews to stable public URLs.
Only do that when the bucket policy genuinely allows anonymous reads — a CDN
origin, say.

**The frontend never receives a credential.** Not an access key, not a secret,
not a session token for the bucket. Only a URL that expires.

---

## What the database holds

Metadata and a reference. Never bytes.

`product_images` carries `object_key`, `bucket`, `file_name`, `mime_type`,
`size_bytes`, `sort_order`, `is_primary`. `url` is kept and still populated
with the object's _canonical_ address — never a presigned one, because a
signature that expires in fifteen minutes has no business in a durable column.

Rows written before object references existed have a null `object_key` and keep
rendering from `url`. That is what made the migration safe to apply to a live
store with no backfill and no coordinated deploy.

`order_items` snapshots `image_key` alongside `image_url`, because a signature
captured at checkout would be long expired by the time anyone opened the order.
The line records _which_ image it was placed with; the URL is minted on read.

---

## Deleting

| Action                      | What goes                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Delete one product image    | The row, then the object. The next image is promoted if the primary went.                        |
| Replace a product's gallery | Rows replaced in the transaction; objects dropped from the payload are swept _after_ it commits. |
| Archive a product           | Rows and objects are kept. See below.                                                            |
| Delete a tenant             | Everything under `tenants/<id>/`. See [TENANCY.md](TENANCY.md).                                  |

Objects are always removed **after** the transaction commits. A file deleted
before the commit would be gone even if the transaction rolled back; the
reverse — a deleted row whose file survives — costs storage and is
recoverable. That is the failure this leans towards deliberately.

### Why archiving a product keeps its files

`order_items` is an immutable snapshot of what a customer bought, and it points
at the same objects. Deleting a product's images when it is archived would
break the thumbnails on every historical order that contained it. Archiving is
a soft delete that preserves history; the files go when the tenant does.

---

## Configuration

| Variable                         | Purpose                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `STORAGE_PROVIDER`               | `minio` \| `s3` \| `local`. The only switch.                   |
| `S3_ENDPOINT`                    | What the **server** talks to.                                  |
| `S3_PUBLIC_ENDPOINT`             | What a **browser** can reach. See below.                       |
| `S3_REGION`, `S3_BUCKET`         |                                                                |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Omit both on AWS to use an IAM role.                           |
| `S3_FORCE_PATH_STYLE`            | True for MinIO, false for AWS.                                 |
| `PRESIGNED_URL_EXPIRY`           | Seconds. Both directions. Must exceed `2 × CACHE_TTL_CATALOG`. |
| `UPLOAD_MAX_FILES`               | Per presign request, and per product.                          |
| `UPLOAD_MAX_FILE_SIZE`           | Bytes, per file.                                               |
| `UPLOAD_ALLOWED_MIME`            | The types accepted, and the only ones sniffed for.             |
| `STORAGE_PUBLIC_READ`            | False keeps the bucket closed and previews presigned.          |
| `STORAGE_ALLOW_LOCAL`            | Required to select the local driver at all.                    |

Never commit a real credential. In production, prefer an IAM role over keys.

### The two endpoints

SigV4 signs the `Host` header. Under Docker the API reaches MinIO at
`http://minio:9000`, but a browser can only reach `http://localhost:9100` — so
a URL signed for the first fails the moment the second is used.

Presigned URLs are therefore signed with a client configured for
`S3_PUBLIC_ENDPOINT`, while ordinary server-side operations use `S3_ENDPOINT`.
When the two agree (real AWS, or any deployment where the API and the browser
use the same URL) it is the same client.

---

## Horizontal scaling

Every API instance talks to the same bucket and holds no upload state, so
replicas are interchangeable. There is nothing on a local disk to lose, nothing
to sync, and no sticky sessions to arrange — which is what makes ECS, EKS, EC2
behind an ASG, or `docker compose up --scale api=3` all work without ceremony.

The only per-instance state is `MediaUrlService`'s in-process URL cache. It is
a convenience, bounded, and correct to lose: a cache miss signs a URL again.

---

## Migrating from local disk

Only needed by a deployment that ran with `STORAGE_PROVIDER=local`.

```bash
pnpm db:storage:migrate                        # dry run — reports, changes nothing
pnpm db:storage:migrate --apply                # upload and repoint database rows
pnpm db:storage:migrate --apply --delete-local # …then remove local copies
```

Nothing is deleted by default, and even with `--delete-local` a file is only
removed after its upload has been verified by reading the object's size back
from the store. Failures are per-file and reported; the run continues. Re-runs
skip anything already uploaded, so an interrupted migration is resumed by
running it again.

---

## Testing

```bash
pnpm test                                   # unit: StorageService, providers, MediaUrlService
pnpm test:e2e                               # needs the databases and MinIO
```

`apps/api/test/storage-isolation.e2e-spec.ts` attacks the storage layer from
four directions: presigned URLs must be tenant-scoped, another tenant's key
must not be signable or confirmable or deletable or attachable to a product,
an upload ticket must not be redeemable for something that is not an image, and
no response may ever carry a storage credential.
