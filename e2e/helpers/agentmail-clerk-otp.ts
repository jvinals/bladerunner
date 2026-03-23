/** Re-export MailSlurp inbox helpers (package name is historical: `@bladerunner/clerk-agentmail-signin`). */
export {
  deleteMailSlurpEmail,
  MAILSURP_CLOCK_SKEW_MS,
  nextNotBeforeMsAfterEmail,
  resolveMailSlurpInboxId,
  waitForClerkOtpFromMailSlurp,
  type ClerkOtpFromMailSlurpResult,
} from '@bladerunner/clerk-agentmail-signin';
