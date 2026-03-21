export { resolveMailSlurpInboxId, waitForClerkOtpFromMailSlurp } from './mailslurp-otp';

export {
  clerkSignInUrlLooksLike,
  detectClerkSignInUi,
  detectClerkOtpInputVisible,
  fillClerkOtpFromMailSlurp,
  performClerkPasswordEmail2FA,
  type FillClerkOtpFromMailSlurpOpts,
  type PerformClerkPasswordEmail2FAOpts,
} from './clerk-sign-in';
