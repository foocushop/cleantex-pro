/**
 * Edge cases test suite for CleanTex Pro
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../server');

let server;
const PORT = 3002;

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

// Helper to make multipart request with a dummy image file
function makeMultipartRequest(payload, fakeFileName, fakeFileContent) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = '';

    for (const [key, val] of Object.entries(payload)) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      body += `${val}\r\n`;
    }

    if (fakeFileName && fakeFileContent) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="photos"; filename="${fakeFileName}"\r\n`;
      body += `Content-Type: image/png\r\n\r\n`;
      body += fakeFileContent;
      body += `\r\n`;
    }

    body += `--${boundary}--\r\n`;

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/requests',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runEdgeCaseTests() {
  console.log('>>> Lancement des tests de cas limites (Edge cases)...\n');
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

  await new Promise(resolve => server = app.listen(PORT, resolve));

  try {
    // Edge case 1: Special French accents, emojis, quotes and HTML tags
    await test('Gère les caractères spéciaux français, guillemets et balises', async () => {
      const payload = {
        nom: "Jean-François d'Hauteville & Cécile",
        telephone: "06.99.88.77.66",
        email: "jf.hauteville@domaine-français.fr",
        service: "Canapé & Fauteuils",
        details: "Tissu alcantara « ultra délicat » <script>alert(1)</script>",
        ville: "Saint-Germain-en-Laye (78100)",
        message: "Café renversé + odeur d'humidité 🐕☕"
      };

      const res = await makeRequest('POST', '/api/requests', payload);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.request.nom, "Jean-François d'Hauteville & Cécile");

      // Cleanup
      await makeRequest('DELETE', `/api/requests/${res.body.request.id}`);
    });

    // Edge case 2: Multipart file upload with picture
    await test('Gère l\'envoi de photos avec multipart/form-data', async () => {
      const payload = {
        nom: 'Lucas Martin',
        telephone: '07 00 11 22 33',
        service: 'Tapis & Moquette',
        ville: 'Paris'
      };

      const res = await makeMultipartRequest(payload, 'tache_canape.png', 'FAKECONTENTIMAGEPNG123');
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.request.photos));
      assert.strictEqual(res.body.request.photos.length, 1);
      assert.ok(res.body.request.photos[0].startsWith('/uploads/'));

      // Check file was actually written to uploads
      const uploadedFile = path.join(__dirname, '..', res.body.request.photos[0]);
      assert.ok(fs.existsSync(uploadedFile));

      // Clean up file & request
      fs.unlinkSync(uploadedFile);
      await makeRequest('DELETE', `/api/requests/${res.body.request.id}`);
    });

    // Edge case 3: Non-existent ID returns 404 cleanly
    await test('PATCH et GET sur ID inexistant renvoient 404', async () => {
      const getRes = await makeRequest('GET', '/api/requests/NON_EXISTENT_ID_9999');
      assert.strictEqual(getRes.status, 404);

      const patchRes = await makeRequest('PATCH', '/api/requests/NON_EXISTENT_ID_9999', { status: 'Terminé' });
      assert.strictEqual(patchRes.status, 404);

      const delRes = await makeRequest('DELETE', '/api/requests/NON_EXISTENT_ID_9999');
      assert.strictEqual(delRes.status, 404);
    });

    // Edge case 4: Filtering on non-existent status returns empty array
    await test('Filtrer par statut inexistant renvoie une liste vide', async () => {
      const res = await makeRequest('GET', '/api/requests?status=Inexistant');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.count, 0);
      assert.deepStrictEqual(res.body.requests, []);
    });

  } finally {
    server.close();
  }

  console.log(`\n====================================================`);
  console.log(`Résultats des tests de cas limites: ${passed} passés, ${failed} échoués`);
  console.log(`====================================================\n`);

  if (failed > 0) process.exit(1);
}

runEdgeCaseTests().catch(err => {
  console.error('Fatal edge error:', err);
  process.exit(1);
});
