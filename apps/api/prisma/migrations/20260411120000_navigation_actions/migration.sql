-- CreateTable
CREATE TABLE "navigation_actions" (
    "id" TEXT NOT NULL,
    "navigation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "element_tag" TEXT,
    "element_id" TEXT,
    "element_text" TEXT,
    "aria_label" TEXT,
    "input_value" TEXT,
    "input_mode" TEXT,
    "page_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "navigation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "navigation_actions_navigation_id_sequence_idx" ON "navigation_actions"("navigation_id", "sequence");

-- AddForeignKey
ALTER TABLE "navigation_actions" ADD CONSTRAINT "navigation_actions_navigation_id_fkey" FOREIGN KEY ("navigation_id") REFERENCES "navigations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
