/**
 * CleanTex Pro - Main Client Interactions
 */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initServiceSelectButtons();
  initBeforeAfterSliders();
  initFaqAccordion();
  initQuoteForm();
  initPhotoPreview();
});

// ----------------------------------------------------
// 1. Mobile Menu
// ----------------------------------------------------
function initMobileMenu() {
  const menuBtn = document.getElementById('mobileMenuBtn');
  const mobileNav = document.getElementById('mobileNav');

  if (menuBtn && mobileNav) {
    const toggleMenu = (forceClose = false) => {
      const isOpen = forceClose ? false : !mobileNav.classList.contains('open');
      mobileNav.classList.toggle('open', isOpen);
      menuBtn.classList.toggle('open', isOpen);
      menuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', isOpen ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    };

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Close mobile menu when clicking a link
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggleMenu(true);
      });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (mobileNav.classList.contains('open') && !mobileNav.contains(e.target) && !menuBtn.contains(e.target)) {
        toggleMenu(true);
      }
    });

    // Close with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        toggleMenu(true);
      }
    });
  }
}

// ----------------------------------------------------
// 2. Service Quick-Select Buttons
// ----------------------------------------------------
function initServiceSelectButtons() {
  const selectBtns = document.querySelectorAll('[data-select-service]');
  const serviceDropdown = document.getElementById('formService');
  const quoteSection = document.getElementById('devis');

  selectBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetService = btn.getAttribute('data-select-service');
      if (serviceDropdown) {
        // Find matching option
        for (let i = 0; i < serviceDropdown.options.length; i++) {
          if (serviceDropdown.options[i].value.toLowerCase().includes(targetService.toLowerCase()) ||
              serviceDropdown.options[i].text.toLowerCase().includes(targetService.toLowerCase())) {
            serviceDropdown.selectedIndex = i;
            break;
          }
        }
      }
      if (quoteSection) {
        quoteSection.scrollIntoView({ behavior: 'smooth' });
        // Highlight form momentarily
        const formCard = document.querySelector('.quote-form-card');
        if (formCard) {
          formCard.style.boxShadow = '0 0 0 4px rgba(0, 187, 166, 0.35)';
          setTimeout(() => {
            formCard.style.boxShadow = '';
          }, 1500);
        }
      }
    });
  });
}

// ----------------------------------------------------
// 3. Before / After Interactive Slider (Clip-path based)
// ----------------------------------------------------
function initBeforeAfterSliders() {
  const sliders = document.querySelectorAll('.compare-container');

  sliders.forEach(container => {
    let isDragging = false;

    function updateSlider(clientX) {
      const rect = container.getBoundingClientRect();
      let pos = (clientX - rect.left) / rect.width;
      if (pos < 0.03) pos = 0.03;
      if (pos > 0.97) pos = 0.97;
      const percentage = (pos * 100).toFixed(2);
      container.style.setProperty('--pos', `${percentage}%`);
    }

    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      updateSlider(e.clientX);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      updateSlider(e.clientX);
    });

    // Touch events for mobile phones & tablets
    container.addEventListener('touchstart', (e) => {
      isDragging = true;
      if (e.touches && e.touches[0]) updateSlider(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDragging = false;
    });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      if (e.touches && e.touches[0]) updateSlider(e.touches[0].clientX);
    }, { passive: true });
  });
}

// ----------------------------------------------------
// 4. FAQ Accordion
// ----------------------------------------------------
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      // Close other items
      faqItems.forEach(other => other.classList.remove('active'));
      // Toggle current
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

// ----------------------------------------------------
// 5. Photo Upload Preview
// ----------------------------------------------------
function initPhotoPreview() {
  const fileInput = document.getElementById('formPhotos');
  const previewContainer = document.getElementById('photoPreviews');

  if (fileInput && previewContainer) {
    fileInput.addEventListener('change', () => {
      previewContainer.innerHTML = '';
      if (!fileInput.files) return;

      Array.from(fileInput.files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.createElement('img');
          img.src = e.target.result;
          img.className = 'preview-thumb';
          img.title = file.name;
          previewContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }
}

// ----------------------------------------------------
// 6. Quote Form Submission & Modal Handling
// ----------------------------------------------------
function initQuoteForm() {
  const form = document.getElementById('quoteForm');
  const submitBtn = document.getElementById('submitQuoteBtn');
  const modal = document.getElementById('successModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalRefNumber = document.getElementById('modalRefNumber');
  const modalClientName = document.getElementById('modalClientName');
  const modalWhatsAppBtn = document.getElementById('modalWhatsAppBtn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Check validity
    const nom = document.getElementById('formNom').value.trim();
    const phone = document.getElementById('formPhone').value.trim();
    const service = document.getElementById('formService').value;

    if (!nom || !phone || !service) {
      showToast('⚠️ Veuillez renseigner au minimum votre nom, téléphone et prestation.');
      return;
    }

    // Submit state
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg style="animation: spin 1s linear infinite; display: inline-block; width: 18px; height: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
      </svg>
      Transmission en cours...
    `;

    try {
      const formData = new FormData(form);

      const response = await fetch('/api/requests', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Success!
        form.reset();
        const photoPreviews = document.getElementById('photoPreviews');
        if (photoPreviews) photoPreviews.innerHTML = '';

        // Fill modal details
        if (modalRefNumber) modalRefNumber.textContent = result.request.id;
        if (modalClientName) modalClientName.textContent = result.request.nom;

        // Configure WhatsApp direct discussion button
        if (modalWhatsAppBtn) {
          const waMessage = encodeURIComponent(
            `Bonjour CleanTex Pro ! Je viens de déposer la demande ${result.request.id} sur votre site pour : ${result.request.service} (${result.request.nom} - ${result.request.telephone}). Pouvez-vous me confirmer vos disponibilités ?`
          );
          modalWhatsAppBtn.href = `https://wa.me/33184742000?text=${waMessage}`;
        }

        // Show modal
        if (modal) modal.classList.add('open');

        showToast(`✅ Demande ${result.request.id} transmise avec succès !`);

        // Update badge
        fetchLiveStatsBadge();
      } else {
        showToast(`❌ Erreur: ${result.error || 'Impossible d\'enregistrer votre demande.'}`);
      }
    } catch (err) {
      console.error(err);
      showToast('❌ Erreur de communication avec le serveur. Veuillez réessayer ou nous contacter par téléphone.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  });

  if (modalCloseBtn && modal) {
    modalCloseBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
      }
    });
  }
}



// ----------------------------------------------------
// 8. Toast Helper
// ----------------------------------------------------
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
  }, 4000);
}
