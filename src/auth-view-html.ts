/**
 * Generates the self-contained HTML for the built-in Onelo auth view.
 * Used by loadAuthView() on paid plans (allowCustomBranding === true).
 * All CSS and JS are inline — no external resources.
 */
export function generateAuthViewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0f0f0f;
    color: #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  .logo-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .app-logo {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    object-fit: cover;
  }

  .app-name {
    font-size: 20px;
    font-weight: 600;
    color: #ffffff;
    text-align: center;
  }

  form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: #a0a0a0;
    font-weight: 500;
  }

  input {
    background: #1a1a1a;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    color: #e8e8e8;
    font-size: 14px;
    padding: 10px 12px;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
  }

  input:focus {
    border-color: #555;
  }

  input::placeholder {
    color: #444;
  }

  button[type="submit"] {
    background: #ffffff;
    color: #0f0f0f;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    padding: 11px;
    cursor: pointer;
    margin-top: 4px;
    transition: opacity 0.15s;
    width: 100%;
  }

  button[type="submit"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: #f87171;
    font-size: 13px;
    text-align: center;
    min-height: 18px;
  }

  .toggle {
    font-size: 13px;
    color: #a0a0a0;
    text-align: center;
  }

  .toggle a {
    color: #e8e8e8;
    text-decoration: underline;
    cursor: pointer;
  }

  .footer {
    position: fixed;
    bottom: 14px;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 12px;
    color: rgba(255,255,255,0.55);
    user-select: none;
    text-decoration: none;
  }
</style>
</head>
<body>
<div class="card" id="card"></div>
<a class="footer" href="https://onelo.tools" target="_blank">
  <svg width="12" height="12" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="39.5" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="17.1"/><circle cx="76.6" cy="23" r="14" fill="#FFA100"/></svg>
  Powered by <strong style="color:rgba(255,255,255,0.85);font-weight:600;">Onelo</strong>
</a>

<script>
(function () {
  var mode = 'signin'; // 'signin' | 'signup'

  function render(config) {
    var card = document.getElementById('card');

    var logoHtml = '';
    if (config.appLogoUrl) {
      logoHtml = '<img class="app-logo" src="' + escHtml(config.appLogoUrl) + '" alt="' + escHtml(config.appName) + '">';
    }

    var heading = mode === 'signin'
      ? 'Sign in to ' + escHtml(config.appName)
      : 'Create account';

    var submitLabel = mode === 'signin' ? 'Sign In' : 'Create Account';

    var confirmField = mode === 'signup'
      ? '<label>Confirm Password<input type="password" id="confirm" placeholder="Confirm password" autocomplete="new-password"></label>'
      : '';

    var toggleText = mode === 'signin'
      ? 'Don\'t have an account? <a id="toggle-link">Sign up</a>'
      : 'Already have an account? <a id="toggle-link">Sign in</a>';

    card.innerHTML =
      '<div class="logo-area">' +
        logoHtml +
        '<div class="app-name">' + heading + '</div>' +
      '</div>' +
      '<form id="auth-form">' +
        '<label>Email<input type="email" id="email" placeholder="you@example.com" autocomplete="email" required></label>' +
        '<label>Password<input type="password" id="password" placeholder="Password" autocomplete="' + (mode === 'signin' ? 'current-password' : 'new-password') + '" required></label>' +
        confirmField +
        '<div class="error" id="error-msg"></div>' +
        '<button type="submit" id="submit-btn">' + submitLabel + '</button>' +
      '</form>' +
      '<div class="toggle">' + toggleText + '</div>';

    document.getElementById('auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      handleSubmit(config);
    });

    var toggleLink = document.getElementById('toggle-link');
    if (toggleLink) {
      toggleLink.addEventListener('click', function () {
        mode = mode === 'signin' ? 'signup' : 'signin';
        render(config);
      });
    }
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showError(msg) {
    var el = document.getElementById('error-msg');
    if (el) el.textContent = msg;
  }

  function clearError() {
    var el = document.getElementById('error-msg');
    if (el) el.textContent = '';
  }

  function setLoading(loading) {
    var btn = document.getElementById('submit-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading
      ? 'Loading\u2026'
      : (mode === 'signin' ? 'Sign In' : 'Create Account');
  }

  async function handleSubmit(config) {
    clearError();
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!email || !password) {
      showError('Please fill in all fields.');
      return;
    }

    if (mode === 'signup') {
      var confirm = document.getElementById('confirm').value;
      if (password !== confirm) {
        showError('Passwords do not match.');
        return;
      }
    }

    setLoading(true);
    try {
      var res = mode === 'signin'
        ? await window.__oneloAuth.signIn(email, password)
        : await window.__oneloAuth.signUp(email, password);

      if (res.success) {
        // Main process closes window and resolves the promise
      } else {
        showError(res.error || 'Authentication failed.');
        setLoading(false);
      }
    } catch (err) {
      showError('Unexpected error. Please try again.');
      setLoading(false);
    }
  }

  async function init() {
    var config = await window.__oneloAuth.getConfig();
    render(config);
  }

  init();
})();
</script>
</body>
</html>`
}
