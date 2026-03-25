-- Encrypted per-user LLM API keys / base URLs (see LLM_CREDENTIALS_ENCRYPTION_KEY).
CREATE TABLE "user_llm_credentials" (
    "user_id" TEXT NOT NULL,
    "payload_encrypted" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_llm_credentials_pkey" PRIMARY KEY ("user_id")
);
