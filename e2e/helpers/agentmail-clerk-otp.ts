/** Re-export MailSlurp inbox helpers (package name is historical: `@bladerunner/clerk-agentmail-signin`). */
export {
  deleteMailSlurpEmail,
  MAILSLURP_POST_PASSWORD_DELAY_MS,
  MAILSURP_CLOCK_SKEW_MS,
  nextNotBeforeMsAfterEmail,
  resolveMailSlurpInboxId,
  sleepMs,
  waitForClerkOtpFromMailSlurp,
  type ClerkOtpFromMailSlurpResult,
} from '@bladerunner/clerk-agentmail-signin';
