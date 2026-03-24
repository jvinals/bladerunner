-- CreateTable
CREATE TABLE "user_llm_preferences" (
    "user_id" TEXT NOT NULL,
    "preferences_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_llm_preferences_pkey" PRIMARY KEY ("user_id")
);
