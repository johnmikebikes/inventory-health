-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "countsAsSellable" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "isGiftCard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legacyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "size" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "compareAtCents" INTEGER,
    "unitCostCents" INTEGER,
    "tracked" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL,
    CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "variantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "committed" INTEGER NOT NULL,
    "incoming" INTEGER NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "damaged" INTEGER NOT NULL,
    "safetyStock" INTEGER NOT NULL,
    "qualityControl" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL,

    PRIMARY KEY ("variantId", "locationId"),
    CONSTRAINT "InventoryLevel_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryMovementDaily" (
    "variantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    PRIMARY KEY ("variantId", "locationId", "date", "kind"),
    CONSTRAINT "InventoryMovementDaily_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VariantMetric" (
    "variantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "retailCents" INTEGER NOT NULL,
    "sold28" INTEGER NOT NULL,
    "sold30" INTEGER NOT NULL,
    "sold60" INTEGER NOT NULL,
    "sold90" INTEGER NOT NULL,
    "soldDeadWindow" INTEGER NOT NULL,
    "sellThrough30" REAL,
    "sellThrough60" REAL,
    "sellThrough90" REAL,
    "weeksOfSupply" REAL,
    "stockCycleStart" DATETIME,
    "ageDays" INTEGER,
    "ageEstimated" BOOLEAN NOT NULL,
    "agingBucket" TEXT NOT NULL,
    "isDead" BOOLEAN NOT NULL,
    "isStockout" BOOLEAN NOT NULL,
    "isLowStock" BOOLEAN NOT NULL,
    "computedAt" DATETIME NOT NULL,

    PRIMARY KEY ("variantId", "locationId"),
    CONSTRAINT "VariantMetric_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductMetric" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "expectedSizes" INTEGER NOT NULL,
    "inStockSizes" INTEGER NOT NULL,
    "brokenRun" BOOLEAN NOT NULL,
    "onHand" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "computedAt" DATETIME NOT NULL,

    PRIMARY KEY ("productId", "locationId"),
    CONSTRAINT "ProductMetric_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailySnapshot" (
    "date" DATETIME NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "retailCents" INTEGER NOT NULL,
    "agedCostCents" INTEGER NOT NULL,
    "deadCostCents" INTEGER NOT NULL,

    PRIMARY KEY ("date", "locationId", "vendor", "productType")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "locationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "defaultViewId" TEXT
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "productId" TEXT NOT NULL PRIMARY KEY,
    "addedBy" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Exclusion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'markdown',
    "addedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "stats" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Product_vendor_idx" ON "Product"("vendor");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_legacyId_key" ON "Variant"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_inventoryItemId_key" ON "Variant"("inventoryItemId");

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- CreateIndex
CREATE INDEX "InventoryLevel_locationId_idx" ON "InventoryLevel"("locationId");

-- CreateIndex
CREATE INDEX "InventoryMovementDaily_date_idx" ON "InventoryMovementDaily"("date");

-- CreateIndex
CREATE INDEX "InventoryMovementDaily_kind_date_idx" ON "InventoryMovementDaily"("kind", "date");

-- CreateIndex
CREATE INDEX "VariantMetric_locationId_agingBucket_idx" ON "VariantMetric"("locationId", "agingBucket");

-- CreateIndex
CREATE INDEX "ProductMetric_locationId_brokenRun_idx" ON "ProductMetric"("locationId", "brokenRun");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_locationId_key" ON "SavedView"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Exclusion_kind_value_scope_key" ON "Exclusion"("kind", "value", "scope");
