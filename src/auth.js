import {
  checkProviderAuth,
  getAuthErrorMessage,
  getProviderName,
} from "./provider.js";

/**
 * Check if the configured provider is installed and authenticated
 */
function checkClaudeCliAuth(options = {}) {
  return checkProviderAuth(options);
}

// Legacy exports for backward compatibility
function isOAuthToken() {
  return false;
}

async function checkAuth(options = {}) {
  return checkProviderAuth(options);
}

export {
  isOAuthToken,
  checkAuth,
  checkClaudeCliAuth,
  getAuthErrorMessage,
  getProviderName,
};
