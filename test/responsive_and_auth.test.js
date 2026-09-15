/**
 * Responsive & Admin Security Verification Suite for CleanTex Pro
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../server');

let server;
const PORT = 3003;

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: reqPath,
      method,
      headers: defaultHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = res.headers['content-type']?.includes('application/json')
            ? JSON.parse(data)
            : data;
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runResponsiveAndAuthTests() {
  console.log('>>> Lancement des tests de Responsiveness et de Sécurité Admin...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error('    Erreur:', err.message);
      failed++;
    }
  }

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  try {
    // 1. Check Homepage does NOT leak admin links
    await test('La page d\'accueil ne doit contenir aucun lien ou référence publique vers /admin', async () => {
      const res = await makeRequest('GET', '/');
      assert.strictEqual(res.status, 200);
      const html = res.body;

      assert.ok(!html.includes('href="/admin"'), 'La page d\'accueil ne doit pas avoir de lien href="/admin"');
      assert.ok(!html.includes('admin-pill-link'), 'La page d\'accueil ne doit pas avoir de bouton admin-pill-link');
      assert.ok(!html.includes('Espace Gérant'), 'La page d\'accueil ne doit pas mentionner Espace Gérant');
      assert.ok(!html.includes('adminRequestsCountBadge'), 'La page d\'accueil ne doit pas avoir de badge de requêtes admin');
      assert.ok(!html.includes('Consulter la réception dans l\'Espace Pro'), 'Le modal client ne doit pas avoir de bouton vers l\'admin');
    });

    // 2. Check mobile header elements
    await test('Le header mobile doit avoir le hamburger à 3 barres et la classe responsive dédiée', async () => {
      const res = await makeRequest('GET', '/');
      const html = res.body;

      assert.ok(html.includes('hamburger-line'), 'Le bouton hamburger doit comporter les barres animées');
      assert.ok(html.includes('header-cta-btn'), 'Le bouton Obtenir un devis du header doit avoir la classe header-cta-btn pour masquage mobile');
      assert.ok(html.includes('mobile-phone-btn'), 'Le header mobile doit comporter le bouton d\'appel direct');
    });

    // 3. CSS overflow rules
    await test('Le fichier style.css doit comporter les règles de confinement anti-overflow horizontal', () => {
      const cssPath = path.join(__dirname, '..', 'public', 'css', 'style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('overflow-x: hidden'), 'style.css doit contenir overflow-x: hidden');
      assert.ok(css.includes('max-width: 100vw'), 'style.css doit contraindre max-width: 100vw');
      assert.ok(css.includes('.header-cta-btn'), 'style.css doit définir .header-cta-btn');
      assert.ok(css.includes('.mobile-menu-btn.open'), 'style.css doit animer le bouton hamburger en croix');
    });

    // 4. Admin lock screen on admin.html
    await test('admin.html doit comporter l\'écran de verrouillage par code PIN et le formulaire d\'authentification', async () => {
      const res = await makeRequest('GET', '/admin');
      assert.strictEqual(res.status, 200);
      const html = res.body;

      assert.ok(html.includes('adminLockOverlay'), 'admin.html doit comporter l\'overlay adminLockOverlay');
      assert.ok(html.includes('adminPinInput'), 'admin.html doit comporter le champ de saisie du PIN');
      assert.ok(html.includes('adminLoginForm'), 'admin.html doit comporter le formulaire adminLoginForm');
      assert.ok(html.includes('adminLogoutBtn'), 'admin.html doit comporter le bouton de verrouillage/déconnexion');
      assert.ok(html.includes('adminChangePinForm'), 'admin.html doit comporter le formulaire de modification du PIN');
    });

    // 5. Auth API: POST /api/auth/login with wrong PIN
    await test('POST /api/auth/login doit refuser un code PIN erroné avec un statut 401', async () => {
      const res = await makeRequest('POST', '/api/auth/login', { pin: '000000' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('incorrect'));
    });

    // 6. Auth API: POST /api/auth/login with correct PIN (default 2026)
    await test('POST /api/auth/login doit accepter le code PIN valide et retourner un jeton de session', async () => {
      const res = await makeRequest('POST', '/api/auth/login', { pin: '2026' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.token === 'string');
      assert.ok(res.body.token.startsWith('ctx_auth_'));
    });

    // 7. Auth API: Change PIN
    await test('POST /api/auth/change-pin doit refuser si le code actuel est faux', async () => {
      const res = await makeRequest('POST', '/api/auth/change-pin', {
        currentPin: 'mauvais_pin',
        newPin: '9999'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    await test('POST /api/auth/change-pin doit refuser un nouveau code trop court', async () => {
      const res = await makeRequest('POST', '/api/auth/change-pin', {
        currentPin: '2026',
        newPin: '12'
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  console.log(`\n====================================================`);
  console.log(`Résultats des tests de sécurité & responsive: ${passed} passés, ${failed} échoués`);
  console.log(`====================================================\n`);

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runResponsiveAndAuthTests();
}

module.exports = runResponsiveAndAuthTests;
