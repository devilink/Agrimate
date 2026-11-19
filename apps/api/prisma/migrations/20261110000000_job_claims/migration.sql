CREATE TABLE "JobClaim" (
    "name" TEXT NOT NULL,
    "forDate" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobClaim_pkey" PRIMARY KEY ("name","forDate")
);

-- As with every other table: only this API reads it, never Supabase's Data API.
ALTER TABLE "JobClaim" ENABLE ROW LEVEL SECURITY;
