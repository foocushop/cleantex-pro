/**
 * CleanTex Pro - Admin & Request Reception System Logic
 */

let currentFilter = 'Tous';
let currentTab = 'requests';
let searchQuery = '';
let autoRefreshTimer = null;
let previousCount = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTabs();
  initFilters();
  initSearch();
  initActions();
});

// ----------------------------------------------------
// 1. Tab Navigation
// ----------------------------------------------------
function initTabs() {
  const tabs = document.querySelectorAll('.admin-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.getAttribute('data-tab');

      document.getElementById('tabRequestsView').style.display = currentTab === 'requests' ? 'block' : 'none';
      document.getElementById('tabNotificationsView').style.display = currentTab === 'notifications' ? 'block' : 'none';
      document.getElementById('tabSettingsView').style.display = currentTab === 'settings' ? 'block' : 'none';

      if (currentTab === 'notifications') {
        loadNotifications();
      }
    });
  });
}

// ----------------------------------------------------
// 2. Status Filters
// ----------------------------------------------------
function initFilters() {
  const filterBtns = document.querySelectorAll('.status-pill-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-status');
      loadRequests();
    });
  });
}

// ----------------------------------------------------
// 3. Search Query
// ----------------------------------------------------
function initSearch() {
  const searchInput = document.getElementById('adminSearchInput');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadRequests();
      }, 300);
    });
  }
}

// ----------------------------------------------------
// 4. Action Buttons (Export, Test Lead, Refresh)
// ----------------------------------------------------
function initActions() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      loadDashboardData().finally(() => {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
      });
    });
  }

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportRequestsToCSV);
  }

  // Logout / lock screen button
  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (_) {}
      // Clear the cookie client-side as fallback
      document.cookie = 'cleantex_admin_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/admin-login';
    });
  }
}

// ----------------------------------------------------
// 5. Main Data Loader
// ----------------------------------------------------
async function loadDashboardData(isBackground = false) {
  await Promise.all([
    loadStats(),
    loadRequests(isBackground)
  ]);
}

// Load statistics counters
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.stats) {
      const { total, nouveau, enCours, termine } = data.stats;
      document.getElementById('statTotalCount').textContent = total;
      document.getElementById('statNewCount').textContent = nouveau;
      document.getElementById('statInProgressCount').textContent = enCours;
      document.getElementById('statDoneCount').textContent = termine;
      
      const tabNewBadge = document.getElementById('tabNewBadge');
      if (tabNewBadge) tabNewBadge.textContent = nouveau;
    }
  } catch (err) {
    console.error('Erreur chargement stats:', err);
  }
}

// Load requests list
async function loadRequests(isBackground = false) {
  try {
    const url = new URL('/api/requests', window.location.origin);
    if (currentFilter !== 'Tous') {
      url.searchParams.set('status', currentFilter);
    }
    if (searchQuery) {
      url.searchParams.set('search', searchQuery);
    }

    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    if (data.success) {
      // Check if new lead arrived to alert user
      if (previousCount !== null && data.count > previousCount && isBackground) {
        showToast('🔔 Nouvelle demande client reçue à l\'instant !');
        playChime();
      }
      previousCount = data.count;

      renderRequests(data.requests);
    }
  } catch (err) {
    console.error('Erreur chargement demandes:', err);
  }
}

// Render request cards
function renderRequests(requests) {
  const container = document.getElementById('requestsContainer');
  if (!container) return;

  if (requests.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
        <h3>Aucune demande pour le moment</h3>
        <p>Les nouvelles demandes déposées par vos clients apparaîtront ici automatiquement en temps réel.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = requests.map(req => {
    const dateFormatted = formatDate(req.createdAt);
    const statusClass = getStatusClass(req.status);
    const cleanPhone = req.telephone.replace(/\s+/g, '');
    const waPhone = cleanPhone.startsWith('0') ? '33' + cleanPhone.slice(1) : cleanPhone;
    const waText = encodeURIComponent(`Bonjour ${req.nom}, c'est CleanTex Pro concernant votre demande de devis #${req.id} pour votre ${req.service}.`);

    return `
      <div class="request-card ${req.status === 'Nouveau' ? 'status-nouveau' : ''}" id="card-${req.id}">
        <div class="request-top-row">
          <div class="request-top-left">
            <span class="request-id-badge">${req.id}</span>
            <span class="request-time">Reçu le ${dateFormatted}</span>
          </div>
          <span class="status-tag ${statusClass}">● ${req.status}</span>
        </div>

        <div class="request-main-grid">
          <!-- Client details -->
          <div class="client-info">
            <h3>${escapeHtml(req.nom)}</h3>
            <div class="client-contact-row">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
              <strong>${escapeHtml(req.telephone)}</strong>
            </div>
            ${req.email ? `
              <div class="client-contact-row">
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                <span>${escapeHtml(req.email)}</span>
              </div>
            ` : ''}
            <div class="client-contact-row">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span>${escapeHtml(req.ville)}</span>
            </div>
          </div>

          <!-- Service details -->
          <div class="service-requested-box">
            <div class="service-label">Prestation demandée</div>
            <div class="service-name">${escapeHtml(req.service)}</div>
            ${req.details ? `<div class="service-subdetails">📝 ${escapeHtml(req.details)}</div>` : ''}
            ${req.dateSouhaitee ? `<div class="service-subdetails" style="margin-top: 4px;">📅 Date souhaitée : ${escapeHtml(req.dateSouhaitee)}</div>` : ''}
            <div style="margin-top: 8px; font-weight: 700; color: #047857; font-size: 0.88rem;">
              Estimation indicative : ${req.estimatifPrix || 'Sur devis'}
            </div>
          </div>

          <!-- Message box -->
          <div class="message-box">
            <div class="message-label">Remarques / État des taches</div>
            <p>${req.message ? `« ${escapeHtml(req.message)} »` : '<em>Aucun commentaire additionnel laissé par le client.</em>'}</p>
          </div>
        </div>

        <!-- Photos if any -->
        ${req.photos && req.photos.length > 0 ? `
          <div class="request-photos-strip">
            <span style="font-size: 0.8rem; font-weight: 700; color: #64748b;">Photos jointes (${req.photos.length}) :</span>
            ${req.photos.map(p => `
              <a href="${p}" target="_blank" class="photo-thumb-link" title="Cliquez pour agrandir">
                <img src="${p}" alt="Photo client">
              </a>
            `).join('')}
          </div>
        ` : ''}

        <!-- Card Footer with Instant Action Buttons -->
        <div class="request-card-footer">
          <div class="quick-contact-btns">
            <a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" class="btn-contact whatsapp" title="Ouvrir WhatsApp direct">
              <span>💬 WhatsApp</span>
            </a>
            <a href="tel:${cleanPhone}" class="btn-contact phone" title="Appeler le client">
              <span>📞 Appeler</span>
            </a>
            ${req.email ? `
              <a href="mailto:${req.email}?subject=Votre demande de devis CleanTex Pro #${req.id}" class="btn-contact email" title="Envoyer un email">
                <span>✉️ Email</span>
              </a>
            ` : ''}
          </div>

          <div class="card-management-controls">
            <select class="status-dropdown" onchange="updateRequestStatus('${req.id}', this.value)" title="Changer le statut">
              <option value="Nouveau" ${req.status === 'Nouveau' ? 'selected' : ''}>Nouveau</option>
              <option value="En cours" ${req.status === 'En cours' ? 'selected' : ''}>En cours</option>
              <option value="Devis envoyé" ${req.status === 'Devis envoyé' ? 'selected' : ''}>Devis envoyé</option>
              <option value="Terminé" ${req.status === 'Terminé' ? 'selected' : ''}>Terminé</option>
              <option value="Archivé" ${req.status === 'Archivé' ? 'selected' : ''}>Archivé</option>
            </select>
            <button class="btn-notes" onclick="toggleNotesPanel('${req.id}')">
              <span>📝 Notes</span>
            </button>
            <button class="btn-delete" onclick="deleteRequest('${req.id}')" title="Supprimer définitivement">
              🗑️
            </button>
          </div>
        </div>

        <!-- Internal Notes Panel (collapsible) -->
        <div class="internal-notes-panel" id="notes-${req.id}">
          <label style="font-size: 0.82rem; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">
            Notes privées (visibles uniquement par vous) :
          </label>
          <textarea id="note-input-${req.id}" rows="2" placeholder="Ex: Devis de 130€ proposé au téléphone, intervention prévue samedi à 14h...">${escapeHtml(req.notesInternes || '')}</textarea>
          <button class="btn-action btn-accent" style="padding: 5px 12px; font-size: 0.82rem;" onclick="saveInternalNote('${req.id}')">
            Enregistrer la note
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// 6. Update Status & Notes API Calls
// ----------------------------------------------------
async function updateRequestStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Statut mis à jour : ${newStatus}`);
      loadStats();
      // update tag visual without re-rendering everything
      const card = document.getElementById(`card-${id}`);
      if (card) {
        const tag = card.querySelector('.status-tag');
        if (tag) {
          tag.className = `status-tag ${getStatusClass(newStatus)}`;
          tag.textContent = `● ${newStatus}`;
        }
      }
    }
  } catch (err) {
    showToast('Erreur mise à jour statut');
  }
}

function toggleNotesPanel(id) {
  const panel = document.getElementById(`notes-${id}`);
  if (panel) {
    panel.classList.toggle('open');
  }
}

async function saveInternalNote(id) {
  const textarea = document.getElementById(`note-input-${id}`);
  if (!textarea) return;

  const notesInternes = textarea.value.trim();
  try {
    const res = await fetch(`/api/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notesInternes })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Note enregistrée avec succès');
      toggleNotesPanel(id);
    }
  } catch (err) {
    showToast('Erreur enregistrement note');
  }
}

async function deleteRequest(id) {
  if (!confirm(`Confirmez-vous la suppression de la demande #${id} ?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Demande #${id} supprimée.`);
      loadDashboardData();
    }
  } catch (err) {
    showToast('Erreur suppression');
  }
}

// ----------------------------------------------------
// ----------------------------------------------------
// 7. Notifications Log Viewer
// ----------------------------------------------------
async function loadNotifications() {
  const container = document.getElementById('notificationsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();

    if (data.success && data.notifications.length > 0) {
      container.innerHTML = data.notifications.map(n => `
        <div class="notif-card">
          <div class="notif-header">
            <h4>${escapeHtml(n.subject)}</h4>
            <span>${formatDate(n.timestamp)}</span>
          </div>
          <div class="notif-body">
            <strong>Destinataire :</strong> ${escapeHtml(n.to)}<br>
            <strong>Aperçu du contenu :</strong> ${escapeHtml(n.content)}
          </div>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <p>Aucune notification enregistrée pour le moment.</p>
        </div>
      `;
    }
  } catch (e) {
    container.innerHTML = '<p>Erreur de chargement des notifications.</p>';
  }
}

// ----------------------------------------------------
// 9. Export to CSV (Excel)
// ----------------------------------------------------
async function exportRequestsToCSV() {
  try {
    const res = await fetch('/api/requests');
    const data = await res.json();
    if (!data.success || !data.requests) return;

    const rows = [
      ['ID', 'Date', 'Statut', 'Nom', 'Téléphone', 'Email', 'Ville', 'Prestation', 'Détails', 'Message', 'Notes']
    ];

    data.requests.forEach(r => {
      rows.push([
        r.id,
        r.createdAt,
        r.status,
        `"${(r.nom || '').replace(/"/g, '""')}"`,
        `"${r.telephone}"`,
        `"${r.email || ''}"`,
        `"${(r.ville || '').replace(/"/g, '""')}"`,
        `"${(r.service || '').replace(/"/g, '""')}"`,
        `"${(r.details || '').replace(/"/g, '""')}"`,
        `"${(r.message || '').replace(/"/g, '""')}"`,
        `"${(r.notesInternes || '').replace(/"/g, '""')}"`
      ]);
    });

    const csvContent = '\uFEFF' + rows.map(e => e.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `cleantex_pro_demandes_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('📁 Export CSV téléchargé avec succès !');
  } catch (err) {
    showToast('Erreur lors de l\'export');
  }
}

// ----------------------------------------------------
// Utilities
// ----------------------------------------------------
function getStatusClass(status) {
  switch (status) {
    case 'Nouveau': return 'tag-nouveau';
    case 'En cours': return 'tag-encours';
    case 'Devis envoyé': return 'tag-devis';
    case 'Terminé': return 'tag-termine';
    case 'Archivé': return 'tag-archive';
    default: return 'tag-nouveau';
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // AudioContext blocked by policy until user interaction
  }
}

function showToast(message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ----------------------------------------------------
// Authentication & Lock Screen Protection
// ----------------------------------------------------
function initAuth() {
  const lockOverlay = document.getElementById('adminLockOverlay');
  const loginForm = document.getElementById('adminLoginForm');
  const pinInput = document.getElementById('adminPinInput');
  const toggleBtn = document.getElementById('togglePinVisBtn');
  const errorMsg = document.getElementById('lockErrorMsg');
  const logoutBtn = document.getElementById('adminLogoutBtn');
  const changePinForm = document.getElementById('adminChangePinForm');

  const startDashboard = () => {
    loadDashboardData();
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
      loadDashboardData(true);
    }, 8000);
  };

  const stopDashboard = () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  };

  // Check existing session token
  const token = sessionStorage.getItem('ctx_admin_token');
  if (token) {
    if (lockOverlay) lockOverlay.classList.remove('active');
    startDashboard();
  } else {
    if (lockOverlay) {
      lockOverlay.classList.add('active');
      setTimeout(() => pinInput && pinInput.focus(), 200);
    }
  }

  // Handle PIN unlock form
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pinVal = pinInput ? pinInput.value.trim() : '';
      if (!pinVal) return;

      const unlockBtn = document.getElementById('unlockAdminBtn');
      if (unlockBtn) {
        unlockBtn.disabled = true;
        unlockBtn.style.opacity = '0.7';
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pinVal })
        });
        const data = await res.json();

        if (data.success && data.token) {
          sessionStorage.setItem('ctx_admin_token', data.token);
          if (errorMsg) errorMsg.textContent = '';
          if (lockOverlay) lockOverlay.classList.remove('active');
          if (pinInput) pinInput.value = '';
          showToast('🔓 Accès gérant déverrouillé');
          startDashboard();
        } else {
          if (errorMsg) {
            errorMsg.textContent = data.error || 'Code PIN incorrect. Accès refusé.';
          }
          const card = document.querySelector('.admin-lock-card');
          if (card) {
            card.classList.remove('shake');
            void card.offsetWidth; // trigger reflow
            card.classList.add('shake');
          }
          if (pinInput) {
            pinInput.select();
            pinInput.focus();
          }
        }
      } catch (err) {
        if (errorMsg) errorMsg.textContent = 'Erreur réseau lors de la vérification.';
      } finally {
        if (unlockBtn) {
          unlockBtn.disabled = false;
          unlockBtn.style.opacity = '1';
        }
      }
    });
  }

  // Toggle PIN visibility
  if (toggleBtn && pinInput) {
    toggleBtn.addEventListener('click', () => {
      const isPass = pinInput.type === 'password';
      pinInput.type = isPass ? 'text' : 'password';
      toggleBtn.textContent = isPass ? '🙈' : '👁️';
    });
  }

  // Logout / Lock screen button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('ctx_admin_token');
      stopDashboard();
      if (lockOverlay) {
        lockOverlay.classList.add('active');
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
      }
      showToast('🔒 Espace d\'administration verrouillé');
    });
  }

  // Change PIN form
  if (changePinForm) {
    changePinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPin = document.getElementById('currentPin')?.value.trim();
      const newPin = document.getElementById('newPin')?.value.trim();

      if (!currentPin || !newPin) return;

      try {
        const res = await fetch('/api/auth/change-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPin, newPin })
        });
        const data = await res.json();

        if (data.success) {
          showToast('✅ Code PIN modifié avec succès !');
          changePinForm.reset();
        } else {
          showToast(`❌ ${data.error || 'Erreur lors du changement de PIN'}`);
        }
      } catch (err) {
        showToast('❌ Erreur de communication avec le serveur');
      }
    });
  }
}
