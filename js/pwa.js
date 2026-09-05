/**
 * QuickLabelCrop - PWA Installation & Service Worker Controller
 * Manages beforeinstallprompt, install buttons, and iOS Add-to-Home-Screen prompt.
 */

(function () {
  'use strict';

  let deferredInstallPrompt = null;

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[QuickLabelCrop] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[QuickLabelCrop] Service Worker registration failed:', err);
        });
    });
  }

  // Detect if app is already running in standalone PWA mode
  const isRunningStandalone = () => {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           (window.navigator.standalone === true);
  };

  // Detect iOS Safari
  const isIos = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent) && !window.MSStream;
  };

  function updateInstallButtons() {
    const installBtns = document.querySelectorAll('.btn-install-pwa');
    const heroInstallPill = document.getElementById('hero-install-pill');

    if (isRunningStandalone()) {
      installBtns.forEach(btn => {
        btn.style.display = 'none';
      });
      if (heroInstallPill) heroInstallPill.style.display = 'none';
      return;
    }

    // If install prompt is ready or on iOS, make sure buttons are visible
    installBtns.forEach(btn => {
      btn.style.display = 'inline-flex';
    });
    if (heroInstallPill) {
      heroInstallPill.style.display = 'inline-flex';
    }
  }

  // Listen for beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent standard mini-infobar from automatically showing on mobile
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[QuickLabelCrop] Install prompt captured');
    updateInstallButtons();
  });

  // Listen for appinstalled event
  window.addEventListener('appinstalled', () => {
    console.log('[QuickLabelCrop] App installed successfully');
    deferredInstallPrompt = null;
    const installBtns = document.querySelectorAll('.btn-install-pwa');
    installBtns.forEach(btn => {
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Installed</span>
      `;
      btn.disabled = true;
      setTimeout(() => { btn.style.display = 'none'; }, 2500);
    });
    const heroInstallPill = document.getElementById('hero-install-pill');
    if (heroInstallPill) heroInstallPill.style.display = 'none';
  });

  // Global trigger function called when any install button is clicked
  window.triggerPWAInstall = async function () {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('[QuickLabelCrop] User accepted install prompt');
      } else {
        console.log('[QuickLabelCrop] User dismissed install prompt');
      }
      deferredInstallPrompt = null;
    } else if (isIos()) {
      showIosInstallModal();
    } else {
      // If browser doesn't support beforeinstallprompt or desktop Chrome already showed it
      showGenericInstallModal();
    }
  };

  function showIosInstallModal() {
    let modal = document.getElementById('pwa-ios-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pwa-ios-modal';
      modal.className = 'pwa-modal-overlay';
      modal.innerHTML = `
        <div class="pwa-modal-card">
          <button class="pwa-modal-close" onclick="closePwaModal()">&times;</button>
          <div class="pwa-modal-icon">
            <img src="/assets/icon-192.png" alt="QuickLabelCrop Icon" width="56" height="56" style="border-radius: 12px;" />
          </div>
          <h3>Install QuickLabelCrop on iOS</h3>
          <p>Install QuickLabelCrop to your iPhone / iPad home screen for instant 1-click access:</p>
          <ol class="pwa-modal-steps">
            <li>Tap the <strong>Share</strong> button <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg> at the bottom of Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>.</li>
            <li>Tap <strong>Add</strong> in the top right corner.</li>
          </ol>
          <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" onclick="closePwaModal()">Got it!</button>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.classList.add('active');
  }

  function showGenericInstallModal() {
    let modal = document.getElementById('pwa-generic-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pwa-generic-modal';
      modal.className = 'pwa-modal-overlay';
      modal.innerHTML = `
        <div class="pwa-modal-card">
          <button class="pwa-modal-close" onclick="closePwaModal()">&times;</button>
          <div class="pwa-modal-icon">
            <img src="/assets/icon-192.png" alt="QuickLabelCrop Icon" width="56" height="56" style="border-radius: 12px;" />
          </div>
          <h3>Install QuickLabelCrop Web App</h3>
          <p>QuickLabelCrop can be installed as an ultra-fast desktop or mobile app:</p>
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; padding: 0.85rem; border-radius: 8px; font-size: 0.88rem; margin: 1rem 0; text-align: left;">
            <p><strong>On Chrome / Edge (Desktop):</strong> Click the install icon (⊕) in the right side of your browser address bar.</p>
            <p style="margin-top: 0.5rem;"><strong>On Android:</strong> Tap the 3 dots menu (⋮) and choose <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.</p>
          </div>
          <button class="btn btn-primary" style="width: 100%;" onclick="closePwaModal()">Close</button>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.classList.add('active');
  }

  window.closePwaModal = function () {
    const modals = document.querySelectorAll('.pwa-modal-overlay');
    modals.forEach(m => m.classList.remove('active'));
  };

  // Wire up button click listeners on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    updateInstallButtons();

    document.querySelectorAll('.btn-install-pwa').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.triggerPWAInstall();
      });
    });

    const heroInstallPill = document.getElementById('hero-install-pill');
    if (heroInstallPill) {
      heroInstallPill.addEventListener('click', (e) => {
        e.preventDefault();
        window.triggerPWAInstall();
      });
    }
  });
})();
