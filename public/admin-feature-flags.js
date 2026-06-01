/**
 * Admin UI feature flags (static default — Railway overrides via GET /admin-feature-flags.js from env).
 * Set AI_LEARNING_ENABLED=true on the backend to show Learning Candidates in the sidebar.
 * Internal override in browser console: window.__CLINIFLOW_AI_LEARNING_ENABLED__ = true; then reload.
 */
(function () {
  window.CLINIFLOW_ADMIN_FEATURES = window.CLINIFLOW_ADMIN_FEATURES || {};
  if (typeof window.CLINIFLOW_ADMIN_FEATURES.aiLearningEnabled !== 'boolean') {
    window.CLINIFLOW_ADMIN_FEATURES.aiLearningEnabled = false;
  }
})();
