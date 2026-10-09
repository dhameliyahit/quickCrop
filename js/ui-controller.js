/**
 * QuickCrop - Unified UI Controller & Utility Helper
 * Shared DOM handling, Toast Notifications, Loading/Error Cards,
 * Memory-safe Direct Print iframe management, and Tab Visibility.
 */

window.QuickCropUI = (function () {
  'use strict';

  let activeDocTitle = document.title;
  const defaultDocTitle = document.title;

  /**
   * Display Error Card
   */
  function showError(title, desc) {
    hideLoading();
    const resultCard = document.getElementById('result-card');
    const uploadArea = document.getElementById('upload-area');
    const cropperErrorCard = document.getElementById('cropper-error-card');
    const cropperErrorTitle = document.getElementById('cropper-error-title');
    const cropperErrorDesc = document.getElementById('cropper-error-desc');

    if (resultCard) resultCard.style.display = 'none';
    if (uploadArea) uploadArea.style.display = 'block';

    if (cropperErrorCard) {
      if (cropperErrorTitle) cropperErrorTitle.textContent = title || 'Unable to Process Label File';
      if (cropperErrorDesc) cropperErrorDesc.textContent = desc || 'Please ensure this is a valid shipping label PDF or image.';
      cropperErrorCard.style.display = 'flex';
      cropperErrorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Hide Error Card
   */
  function hideError() {
    const cropperErrorCard = document.getElementById('cropper-error-card');
    if (cropperErrorCard) {
      cropperErrorCard.style.display = 'none';
    }
  }

  /**
   * Toast Notification Popup
   */
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.cropper-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `cropper-toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * Loading State Helpers
   */
  function showLoading(title, desc, status, fileName) {
    hideError();
    document.title = '⏳ Processing Labels... — QuickCrop';

    const loadingState = document.getElementById('loading-state');
    const loadingTitle = document.getElementById('loading-title');
    const loadingDesc = document.getElementById('loading-desc');
    const loadingStatus = document.getElementById('loading-status');
    const loadingBar = document.getElementById('loading-progress-bar');
    const loadingFilePill = document.getElementById('loading-file-pill');
    const loadingFileName = document.getElementById('loading-file-name');
    const uploadArea = document.getElementById('upload-area');
    const resultCard = document.getElementById('result-card');

    if (loadingState) {
      loadingState.style.display = 'block';
      if (loadingTitle) loadingTitle.textContent = title || 'Processing Shipping Labels...';
      if (loadingDesc) loadingDesc.textContent = desc || 'Scanning document pages and isolating label boundaries.';
      if (loadingStatus) loadingStatus.textContent = status || 'Reading vector data...';

      if (loadingFilePill && loadingFileName) {
        if (fileName) {
          loadingFileName.textContent = fileName;
          loadingFilePill.title = fileName;
          loadingFilePill.style.display = 'inline-flex';
        } else {
          loadingFilePill.style.display = 'none';
        }
      }

      if (loadingBar) {
        loadingBar.style.animation = '';
        loadingBar.style.width = '35%';
      }
    }
    if (uploadArea) uploadArea.style.display = 'none';
    if (resultCard) resultCard.style.display = 'none';
  }

  function updateLoadingProgress(statusText, percent) {
    const loadingStatus = document.getElementById('loading-status');
    const loadingBar = document.getElementById('loading-progress-bar');
    if (loadingStatus) loadingStatus.textContent = statusText;
    if (loadingBar && typeof percent === 'number') {
      loadingBar.style.animation = 'none';
      loadingBar.style.width = `${Math.min(100, Math.max(8, percent))}%`;
    }
  }

  function hideLoading() {
    const loadingState = document.getElementById('loading-state');
    if (loadingState) loadingState.style.display = 'none';
  }

  /**
   * Memory-safe Direct Print execution (Auto-removes iframe and revokes Blob URL)
   */
  async function performDirectPrint(getPdfBytesFn, btnElement, marketName = 'Labels') {
    if (!btnElement) return;
    btnElement.disabled = true;
    const origHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<span>⏳ Preparing Print...</span>`;

    try {
      const outputBytes = await getPdfBytesFn();
      if (!outputBytes) throw new Error('Failed to generate printable PDF.');

      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);

      const printIframe = document.createElement('iframe');
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      printIframe.src = blobUrl;

      printIframe.onload = () => {
        btnElement.disabled = false;
        btnElement.innerHTML = origHtml;
        try {
          printIframe.contentWindow.focus();
          printIframe.contentWindow.print();
        } catch (e) {
          console.warn('Direct print window focus error:', e);
        }
        // Memory leak fix: Cleanup iframe and revoke Blob URL after print dialog closes
        setTimeout(() => {
          if (printIframe.parentNode) {
            document.body.removeChild(printIframe);
          }
          URL.revokeObjectURL(blobUrl);
        }, 60000);
      };

      document.body.appendChild(printIframe);
    } catch (err) {
      console.error('Direct print error:', err);
      showToast(`Could not start direct print: ${err.message}. Please download the 4x6 PDF instead.`, 'error');
      btnElement.disabled = false;
      btnElement.innerHTML = origHtml;
    }
  }

  /**
   * Setup Drag & Drop Zone
   */
  function setupDropzone(dropzoneEl, fileInputEl, onFileSelected) {
    if (!dropzoneEl || !fileInputEl) return;

    dropzoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneEl.classList.add('dragover');
    });

    dropzoneEl.addEventListener('dragleave', () => {
      dropzoneEl.classList.remove('dragover');
    });

    dropzoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        onFileSelected(e.dataTransfer.files[0]);
      }
    });

    dropzoneEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      fileInputEl.click();
    });
  }

  /**
   * Bind Tab Visibility Handler
   */
  function bindVisibilityTitle(getOrdersCountFn, marketplaceName = '') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const count = typeof getOrdersCountFn === 'function' ? getOrdersCountFn() : 0;
        if (count > 0) {
          document.title = `📦 (${count} ${marketplaceName} Orders Ready) Print 4x6 Labels — QuickCrop`;
        } else {
          document.title = `⚡ Free 4x6 Shipping Label Cropper — QuickCrop`;
        }
      } else {
        document.title = activeDocTitle;
      }
    });
  }

  function setActiveDocTitle(title) {
    activeDocTitle = title;
    document.title = title;
  }

  return {
    showError,
    hideError,
    showToast,
    showLoading,
    updateLoadingProgress,
    hideLoading,
    performDirectPrint,
    setupDropzone,
    bindVisibilityTitle,
    setActiveDocTitle,
  };
})();
