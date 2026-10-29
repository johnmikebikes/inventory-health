-- CreateTable
CREATE TABLE "StyleRow" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "retailCents" INTEGER NOT NULL,
    "sold30" INTEGER NOT NULL,
    "sold90" INTEGER NOT NULL,
    "sellThrough30" REAL,
    "sellThrough90" REAL,
    "weeksOfSupply" REAL,
    "ageDays" INTEGER,
    "ageEstimated" BOOLEAN NOT NULL,
    "bucket" TEXT NOT NULL,
    "isDead" BOOLEAN NOT NULL,
    "stockoutVariants" INTEGER NOT NULL,
    "lowStockVariants" INTEGER NOT NULL,
    "brokenRun" BOOLEAN NOT NULL,
    "expectedSizes" INTEGER NOT NULL,
    "inStockSizes" INTEGER NOT NULL,
    "missingCost" BOOLEAN NOT NULL,
    "computedAt" DATETIME NOT NULL,

    PRIMARY KEY ("productId", "locationId")
);

-- CreateIndex
CREATE INDEX "StyleRow_locationId_idx" ON "StyleRow"("locationId");
