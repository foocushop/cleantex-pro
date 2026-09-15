/**
 * Automated Verification Suite for CleanTex Pro
 */

const assert = require('assert');
const http = require('http');
const app = require('../server');

let server;
const PORT = 3001; // Use separate port for tests

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
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

async function runTests() {
  console.log('>>> Lancement de la suite de tests CleanTex Pro...\n');
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

  // Start test server
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  try {
    // 1. Static Pages
    await test('GET / doit renvoyer la page d\'accueil client en HTML', async () => {
      const res = await makeRequest('GET', '/');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('CleanTex'));
      assert.ok(res.body.includes('Nettoyage en profondeur pour les textiles qui comptent'));
    });

    await test('GET /admin doit renvoyer l\'espace de réception des requêtes en HTML', async () => {
      const res = await makeRequest('GET', '/admin');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('Boîte de Réception des Demandes Clients'));
    });

    // 2. Form Submission API
    await test('POST /api/requests doit refuser les soumissions incomplètes (Validation)', async () => {
      const res = await makeRequest('POST', '/api/requests', { nom: 'Incomplet' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    let createdId;
    await test('POST /api/requests doit enregistrer une vraie demande de devis client', async () => {
      const payload = {
        nom: 'Camille Vasseur',
        telephone: '06 11 22 33 44',
        email: 'camille.vasseur@test.com',
        service: 'Canapé & Fauteuils',
        details: 'Canapé 3 places velours vert émeraude',
        ville: 'Boulogne-Billancourt',
        dateSouhaitee: '2026-09-22',
        message: 'Tache de vin rouge récente sur l\'assise droite.'
      };

      const res = await makeRequest('POST', '/api/requests', payload);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.request);
      assert.ok(res.body.request.id.startsWith('DEV-'));
      assert.strictEqual(res.body.request.status, 'Nouveau');
      assert.strictEqual(res.body.request.nom, 'Camille Vasseur');
      createdId = res.body.request.id;
    });

    // 3. Reception in Admin
    await test('GET /api/requests doit lister la demande créée dans la boîte de réception', async () => {
      const res = await makeRequest('GET', '/api/requests');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.requests));
      const found = res.body.requests.find(r => r.id === createdId);
      assert.ok(found, `La demande ${createdId} devrait être présente dans la liste`);
      assert.strictEqual(found.service, 'Canapé & Fauteuils');
    });

    // 4. Filtering & Searching
    await test('GET /api/requests?search=Camille doit trouver la requête par nom', async () => {
      const res = await makeRequest('GET', '/api/requests?search=Camille');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.requests.length >= 1);
      assert.strictEqual(res.body.requests[0].nom, 'Camille Vasseur');
    });

    // 5. Status update & Internal Notes
    await test('PATCH /api/requests/:id doit modifier le statut et sauvegarder des notes', async () => {
      const res = await makeRequest('PATCH', `/api/requests/${createdId}`, {
        status: 'Devis envoyé',
        notesInternes: 'Contacté à 14h30, devis de 89€ proposé et validé.'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.request.status, 'Devis envoyé');
      assert.strictEqual(res.body.request.notesInternes, 'Contacté à 14h30, devis de 89€ proposé et validé.');
    });

    // 6. Stats endpoint
    await test('GET /api/stats doit renvoyer des métriques cohérentes', async () => {
      const res = await makeRequest('GET', '/api/stats');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.stats.total === 'number');
      assert.ok(res.body.stats.total >= 1);
    });

    // 7. Notifications Log
    await test('GET /api/notifications doit contenir la notification de réception', async () => {
      const res = await makeRequest('GET', '/api/notifications');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.notifications));
      const notif = res.body.notifications.find(n => n.subject && n.subject.includes(createdId));
      assert.ok(notif, 'Une alerte de réception doit exister pour cette demande');
    });

    // 8. Delete Request
    await test('DELETE /api/requests/:id doit supprimer la demande proprement', async () => {
      const res = await makeRequest('DELETE', `/api/requests/${createdId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify deletion
      const checkRes = await makeRequest('GET', `/api/requests/${createdId}`);
      assert.strictEqual(checkRes.status, 404);
    });

  } finally {
    server.close();
  }

  console.log(`\n====================================================`);
  console.log(`Résultats des tests: ${passed} passés, ${failed} échoués`);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
