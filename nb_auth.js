/**
 * NB Auth Module — Google Sign-In gate for all NB apps
 * 
 * SETUP (one-time):
 * 1. Go to https://console.cloud.google.com/
 * 2. Create project (or use existing)
 * 3. APIs & Services → Credentials → Create OAuth Client ID
 *    - Application type: Web application
 *    - Authorized JavaScript origins: 
 *      https://louieelizondo.github.io
 *      http://localhost (for testing)
 *    - No redirect URIs needed
 * 4. Copy the Client ID and paste it below
 * 5. Deploy updated files to GitHub Pages
 *
 * ALLOWED_EMAILS: add the Gmail addresses that can access the apps
 */

// ════════════════════════════════════════
// CONFIG — edit these two values
// ════════════════════════════════════════
const NB_AUTH_CLIENT_ID = localStorage.getItem('nb_google_client_id') || '934893720921-82k6l5gbm5kt3oq1nti1njitlgennqdl.apps.googleusercontent.com';
const NB_ALLOWED_EMAILS = [
  'le.nbclub@gmail.com',
  'facturacion.nbclub@gmail.com',
  'servicioalcliente.nbclub@gmail.com',
  'adelalviddrez@gmail.com',
  'ing.elizondocardenas@gmail.com',
];

// ════════════════════════════════════════
// AUTH STATE
// ════════════════════════════════════════
const NB_AUTH_KEY = 'nb_auth_user';
let nbAuthUser = null;

function getNbAuthUser() {
  if (nbAuthUser) return nbAuthUser;
  try {
    const stored = sessionStorage.getItem(NB_AUTH_KEY);
    if (stored) {
      nbAuthUser = JSON.parse(stored);
      return nbAuthUser;
    }
  } catch(e) {}
  return null;
}

function setNbAuthUser(user) {
  nbAuthUser = user;
  sessionStorage.setItem(NB_AUTH_KEY, JSON.stringify(user));
}

function clearNbAuth() {
  nbAuthUser = null;
  sessionStorage.removeItem(NB_AUTH_KEY);
  location.reload();
}

// ════════════════════════════════════════
// LOGIN OVERLAY UI
// ════════════════════════════════════════
function createAuthOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'nbAuthOverlay';
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div style="background:white;border-radius:20px;padding:40px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="width:64px;height:64px;background:#2e6b2e;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;font-weight:900;color:white">NB</div>
        <h2 style="font-size:20px;margin-bottom:8px;color:#2d2319">Iniciar Sesión</h2>
        <p style="font-size:13px;color:#888;margin-bottom:24px">Acceso restringido — solo cuentas autorizadas</p>
        <div id="nbGsiButtonContainer" style="display:flex;justify-content:center;margin-bottom:16px"></div>
        <div id="nbAuthSetupMsg" style="display:none;padding:16px;background:#fff3e0;border-radius:12px;font-size:12px;color:#e65100;text-align:left;line-height:1.5">
          <strong>⚙️ Setup requerido:</strong><br>
          Configura el Google Client ID.<br>
          <input type="text" id="nbClientIdInput" placeholder="Tu Client ID de Google Cloud" style="width:100%;margin-top:8px;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:11px;font-family:monospace">
          <button onclick="saveNbClientId()" style="margin-top:8px;padding:6px 16px;background:#2e6b2e;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Guardar Client ID</button>
        </div>
        <p id="nbAuthError" style="display:none;color:#c62828;font-size:12px;margin-top:12px"></p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showAuthError(msg) {
  const el = document.getElementById('nbAuthError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function saveNbClientId() {
  const input = document.getElementById('nbClientIdInput');
  const id = (input?.value || '').trim();
  if (!id.includes('.apps.googleusercontent.com')) {
    showAuthError('Client ID debe terminar en .apps.googleusercontent.com');
    return;
  }
  localStorage.setItem('nb_google_client_id', id);
  location.reload();
}

// ════════════════════════════════════════
// GOOGLE SIGN-IN CALLBACK
// ════════════════════════════════════════
function handleNbCredentialResponse(response) {
  try {
    // Decode JWT payload (base64url → JSON)
    const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const email = (payload.email || '').toLowerCase();
    const name = payload.name || email;
    
    if (!NB_ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email)) {
      showAuthError('❌ ' + email + ' no tiene acceso. Contacta al administrador.');
      return;
    }
    
    setNbAuthUser({ email, name, picture: payload.picture || '', token: response.credential });
    const overlay = document.getElementById('nbAuthOverlay');
    if (overlay) overlay.remove();
    
    // Trigger app init
    if (typeof nbAppInit === 'function') nbAppInit();
  } catch(e) {
    showAuthError('Error al verificar credenciales: ' + e.message);
  }
}

// ════════════════════════════════════════
// MAIN: requireAuth()
// Call this at the start of your app's load handler
// ════════════════════════════════════════
function requireNbAuth(callback) {
  // If already authenticated this session, proceed
  const user = getNbAuthUser();
  if (user && NB_ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) {
    if (callback) callback();
    return;
  }
  
  // No auth — show overlay
  createAuthOverlay();
  
  // Store callback for after login
  window.nbAppInit = callback;
  
  const clientId = NB_AUTH_CLIENT_ID;
  if (!clientId) {
    // No client ID configured yet — show setup form
    document.getElementById('nbAuthSetupMsg').style.display = 'block';
    document.getElementById('nbGsiButtonContainer').style.display = 'none';
    return;
  }
  
  // Load Google Identity Services
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleNbCredentialResponse,
      auto_select: true,   // auto-login if only one account
      cancel_on_tap_outside: false
    });
    google.accounts.id.renderButton(
      document.getElementById('nbGsiButtonContainer'),
      { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es', width: 280 }
    );
    // Also try One Tap
    google.accounts.id.prompt();
  };
  script.onerror = () => {
    showAuthError('No se pudo cargar Google Sign-In. Verifica tu conexión.');
  };
  document.head.appendChild(script);
}

// ════════════════════════════════════════
// USER INFO BADGE (optional — call after auth)
// ════════════════════════════════════════
function renderNbUserBadge(containerId) {
  const user = getNbAuthUser();
  if (!user) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;opacity:.85;cursor:pointer" onclick="if(confirm('¿Cerrar sesión?'))clearNbAuth()" title="Click para cerrar sesión">
      ${user.picture ? `<img src="${user.picture}" style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.3)">` : ''}
      <span>${user.name.split(' ')[0]}</span>
    </div>
  `;
}
