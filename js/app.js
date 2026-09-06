/**
 * QuickCrop - Flipkart Shipping Label App Controller
 * Handles PDF & Image uploads, vector cropping, instant preview, pagination, and printing
 */

(function () {
  'use strict';

  // Global State
  let currentPdfBytes = null;
  let currentPdfDocProxy = null;
  let pagesMetadata = [];
  let currentPage = 1;
  let currentLabelBox = FLIPKART_LABEL_BOX;

  let currentImageCropResult = null;
  let isImageMode = false;

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const chooseFileBtn = document.getElementById('btn-choose-file');

  const uploadArea = document.getElementById('upload-area');
  const resultCard = document.getElementById('result-card');
  const fileNameDisplay = document.getElementById('file-name');
  const fileSizeDisplay = document.getElementById('file-size');
  const orderCountDisplay = document.getElementById('order-count');
  const changeFileBtn = document.getElementById('btn-change-file');

  const loadingState = document.getElementById('loading-state');
  const loadingTitle = document.getElementById('loading-title');
  const loadingDesc = document.getElementById('loading-desc');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBar = document.getElementById('loading-progress-bar');
  const loadingFilePill = document.getElementById('loading-file-pill');
  const loadingFileName = document.getElementById('loading-file-name');

  // Error Card Elements
  const cropperErrorCard = document.getElementById('cropper-error-card');
  const cropperErrorTitle = document.getElementById('cropper-error-title');
  const cropperErrorDesc = document.getElementById('cropper-error-desc');
  const btnErrorRetry = document.getElementById('btn-error-retry');
  const btnErrorDismiss = document.getElementById('btn-error-dismiss');

  const canvas = document.getElementById('pdf-canvas');
  const orderMetaDisplay = document.getElementById('order-meta-display');

  const prevPageBtn = document.getElementById('btn-prev-page');
  const nextPageBtn = document.getElementById('btn-next-page');
  const pageIndicator = document.getElementById('page-indicator');
  const stepperRow = document.getElementById('stepper-row');

  const btnDownloadPdf = document.getElementById('btn-download-pdf');
  const btnTopDownloadPdf = document.getElementById('btn-top-download-pdf');
  const btnDirectPrint = document.getElementById('btn-direct-print');
  const btnDownloadInvoices = document.getElementById('btn-download-invoices');
  const btnDownloadPng = document.getElementById('btn-download-png');

  // Error State Display
  function showError(title, desc) {
    hideLoading();
    if (resultCard) resultCard.style.display = 'none';
    if (uploadArea) uploadArea.style.display = 'block';

    if (cropperErrorCard) {
      if (cropperErrorTitle) cropperErrorTitle.textContent = title || 'Unable to Process Label File';
      if (cropperErrorDesc) cropperErrorDesc.textContent = desc || 'Please ensure this is a valid Flipkart shipping label PDF or image.';
      cropperErrorCard.style.display = 'flex';
      cropperErrorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function hideError() {
    if (cropperErrorCard) {
      cropperErrorCard.style.display = 'none';
    }
  }

  // Toast Notification
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

  // Loading State Helpers
  function showLoading(title, desc, status, fileName) {
    hideError();
    if (loadingState) {
      loadingState.style.display = 'block';
      if (loadingTitle) loadingTitle.textContent = title || 'Processing Shipping Labels...';
      if (loadingDesc) loadingDesc.textContent = desc || 'Scanning PDF pages and isolating thermal label boundaries.';
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
    if (loadingStatus) loadingStatus.textContent = statusText;
    if (loadingBar && typeof percent === 'number') {
      loadingBar.style.animation = 'none';
      loadingBar.style.width = `${Math.min(100, Math.max(8, percent))}%`;
    }
  }

  function hideLoading() {
    if (loadingState) loadingState.style.display = 'none';
  }

  // Error Card Action Listeners
  if (btnErrorRetry) {
    btnErrorRetry.addEventListener('click', () => {
      hideError();
      if (fileInput) fileInput.click();
    });
  }

  if (btnErrorDismiss) {
    btnErrorDismiss.addEventListener('click', () => {
      hideError();
    });
  }

  // Drag & Drop
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadSelectedFile(e.dataTransfer.files[0]);
      }
    });

    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      fileInput.click();
    });
  }

  if (chooseFileBtn) chooseFileBtn.addEventListener('click', () => fileInput.click());

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        loadSelectedFile(e.target.files[0]);
      }
    });
  }

  // Upload Another File
  if (changeFileBtn) {
    changeFileBtn.addEventListener('click', () => {
      currentPdfBytes = null;
      currentPdfDocProxy = null;
      pagesMetadata = [];
      currentImageCropResult = null;
      isImageMode = false;
      currentLabelBox = FLIPKART_LABEL_BOX;
      if (fileInput) fileInput.value = '';
      hideLoading();
      hideError();
      resultCard.style.display = 'none';
      uploadArea.style.display = 'block';
    });
  }

  // Determine file type and delegate with complete error validation
  async function loadSelectedFile(file) {
    hideError();
    if (!file) return;

    // Validate 0-byte or empty file
    if (file.size === 0) {
      showError('Empty File Selected', 'The selected file has 0 bytes. Please ensure the file downloaded completely from Flipkart Seller Hub.');
      return;
    }

    // Validate excessive file size (> 80MB)
    if (file.size > 80 * 1024 * 1024) {
      showError('File Exceeds Size Limit', `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Flipkart shipping label files are normally under 15 MB.`);
      return;
    }

    const fileName = (file.name || '').toLowerCase();
    const fileType = (file.type || '').toLowerCase();

    if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
      isImageMode = false;
      try {
        const buffer = await file.arrayBuffer();
        await processPdfBuffer(buffer, file.name);
      } catch (err) {
        console.error('File read error:', err);
        showError('File Access Error', 'Could not read file from your device. Please try selecting the file again.');
      }
    } else if (
      fileName.endsWith('.png') ||
      fileName.endsWith('.jpg') ||
      fileName.endsWith('.jpeg') ||
      fileName.endsWith('.webp') ||
      fileType.startsWith('image/')
    ) {
      isImageMode = true;
      await processImageFile(file);
    } else {
      showError(
        'Unsupported File Format',
        `"${file.name}" is not a supported format. Please upload an official Flipkart shipping label PDF (.pdf) or image (.png, .jpg, .webp).`
      );
    }
  }

  // Process PDF Buffer with Comprehensive Error Handling
  async function processPdfBuffer(buffer, fileName) {
    try {
      showLoading('Processing Shipping Labels...', 'Analyzing document pages and isolating shipping labels...', 'Reading PDF streams...', fileName);

      if (!buffer || buffer.byteLength === 0) {
        showError('Empty PDF Document', 'The uploaded PDF file contains no data. Please re-download the label from Flipkart Seller Hub.');
        return;
      }

      // Clone buffer so PDF.js worker transfer NEVER detaches currentPdfBytes!
      const cleanBuffer = buffer.slice(0);
      currentPdfBytes = new Uint8Array(cleanBuffer);
      currentImageCropResult = null;
      isImageMode = false;

      // Load with PDF.js using a separate clone
      const pdfJsBuffer = buffer.slice(0);
      try {
        currentPdfDocProxy = await loadPdfDoc(pdfJsBuffer);
      } catch (pdfJsErr) {
        console.error('PDF.js parse error:', pdfJsErr);
        if (pdfJsErr.name === 'PasswordException' || (pdfJsErr.message && pdfJsErr.message.toLowerCase().includes('password'))) {
          showError('Password Protected PDF', 'This PDF is encrypted with a password. QuickCrop cannot process locked documents. Please remove the password or download the unencrypted label PDF directly from Flipkart.');
          return;
        }
        if (pdfJsErr.name === 'InvalidPDFException' || (pdfJsErr.message && pdfJsErr.message.toLowerCase().includes('invalid pdf'))) {
          showError('Corrupted PDF File', 'This file is corrupted or not a recognized PDF document. Please verify the file or re-download it from Flipkart Seller Hub.');
          return;
        }
        showError('Unable to Open PDF', 'Failed to parse the PDF document: ' + (pdfJsErr.message || 'Unknown PDF error') + '. Please ensure this is a standard Flipkart shipping label PDF.');
        return;
      }

      if (!currentPdfDocProxy || currentPdfDocProxy.numPages === 0) {
        showError('Empty Document', 'The uploaded PDF document contains 0 pages.');
        return;
      }

      const totalPages = currentPdfDocProxy.numPages;
      updateLoadingProgress(`Reading 1 of ${totalPages} pages...`, 15);

      pagesMetadata = await parsePdfMetadata(currentPdfDocProxy, (current, total) => {
        const pct = Math.round(15 + (current / total) * 75);
        updateLoadingProgress(`Scanning order ${current} of ${total}...`, pct);
      });

      if (!pagesMetadata || pagesMetadata.length === 0) {
        showError('No Orders Detected', 'Could not detect any shipping orders in this PDF. Please ensure this is an official Flipkart shipping label document.');
        return;
      }

      // Automatically group and sort multi-order batches by SKU for consecutive packing
      if (pagesMetadata.length > 1) {
        pagesMetadata.sort((a, b) => {
          const skuA = (a.sku || '').toLowerCase().trim();
          const skuB = (b.sku || '').toLowerCase().trim();
          if (skuA && skuB && skuA !== skuB) {
            return skuA.localeCompare(skuB, undefined, { numeric: true, sensitivity: 'base' });
          }
          return a.pageIndex - b.pageIndex;
        });
      }

      currentLabelBox = pagesMetadata.detectedBox || FLIPKART_LABEL_BOX;

      updateLoadingProgress('Formatting thermal label preview...', 95);

      // Update File Banner
      if (fileNameDisplay) {
        fileNameDisplay.textContent = fileName;
        fileNameDisplay.title = fileName;
      }
      if (fileSizeDisplay) {
        const sizeKb = buffer.byteLength / 1024;
        fileSizeDisplay.textContent = sizeKb >= 1024 ? (sizeKb / 1024).toFixed(2) + ' MB' : sizeKb.toFixed(1) + ' KB';
      }
      if (orderCountDisplay) {
        const isGrouped = pagesMetadata.length > 1;
        orderCountDisplay.textContent = `${pagesMetadata.length} Order${pagesMetadata.length > 1 ? 's' : ''} Ready${isGrouped ? ' (Grouped by SKU)' : ''}`;
      }

      if (btnDownloadInvoices) btnDownloadInvoices.style.display = 'inline-flex';
      if (btnDownloadPng) btnDownloadPng.style.display = 'none';

      hideLoading();
      resultCard.style.display = 'block';

      currentPage = 1;
      updatePaginationUI();
      renderCurrentPage();

      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Processing error:', err);
      showError('Error Processing PDF', (err.message || 'An unexpected error occurred while analyzing the PDF.') + ' Please verify the file and try again.');
    }
  }

  // Process Image File with Comprehensive Error Handling
  async function processImageFile(file) {
    try {
      showLoading('Processing Label Image...', 'Extracting Flipkart shipping label from image...', 'Cropping label...', file.name);

      const result = await cropFlipkartLabelImage(file);
      currentImageCropResult = result;
      currentPdfBytes = result.pdfBytes;
      pagesMetadata = [{
        orderId: 'Cropped Label Image',
        courier: 'E-Kart Logistics',
        sku: 'Flipkart Order',
        pageIndex: 0,
      }];

      if (fileNameDisplay) {
        fileNameDisplay.textContent = file.name;
        fileNameDisplay.title = file.name;
      }
      if (fileSizeDisplay) {
        const sizeKb = file.size / 1024;
        fileSizeDisplay.textContent = sizeKb >= 1024 ? (sizeKb / 1024).toFixed(2) + ' MB' : sizeKb.toFixed(1) + ' KB';
      }
      if (orderCountDisplay) orderCountDisplay.textContent = '1 Cropped Label Ready';

      if (stepperRow) stepperRow.style.display = 'none';
      if (btnDownloadInvoices) btnDownloadInvoices.style.display = 'none';
      if (btnDownloadPng) btnDownloadPng.style.display = 'inline-flex';

      // Draw on preview canvas
      if (canvas) {
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(result.canvas, 0, 0);
      }

      if (orderMetaDisplay) {
        orderMetaDisplay.textContent = '100% Cropped Shipping Label';
      }

      hideLoading();
      resultCard.style.display = 'block';
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Image crop error:', err);
      showError('Image Processing Error', 'Could not crop the shipping label from this image: ' + (err.message || 'Image decode failed') + '. Please ensure the image clearly displays the Flipkart shipping label.');
    }
  }

  // Stepper
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        updatePaginationUI();
        renderCurrentPage();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPage < pagesMetadata.length) {
        currentPage++;
        updatePaginationUI();
        renderCurrentPage();
      }
    });
  }

  function updatePaginationUI() {
    if (!stepperRow) return;
    if (pagesMetadata.length <= 1) {
      stepperRow.style.display = 'none';
    } else {
      stepperRow.style.display = 'flex';
      if (pageIndicator) pageIndicator.textContent = `Order ${currentPage} of ${pagesMetadata.length}`;
      if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
      if (nextPageBtn) nextPageBtn.disabled = currentPage >= pagesMetadata.length;
    }
  }

  // Render Cropped Label on Canvas
  async function renderCurrentPage() {
    if (isImageMode) return;
    if (!currentPdfDocProxy || !canvas) return;

    const meta = pagesMetadata[currentPage - 1];
    if (meta && orderMetaDisplay) {
      const skuText = meta.sku && meta.sku !== 'General Product' && meta.sku !== 'General SKU' ? ` • SKU: ${meta.sku}` : '';
      orderMetaDisplay.textContent = `${meta.orderId} • ${meta.courier}${skuText}`;
    }

    try {
      const sourcePageNum = meta ? (meta.pageIndex + 1) : currentPage;
      const page = await currentPdfDocProxy.getPage(sourcePageNum);
      const a4Height = 841.89;
      const cropScale = 1.6;

      const offscreen = document.createElement('canvas');
      const offCtx = offscreen.getContext('2d');
      const viewport = page.getViewport({ scale: cropScale });

      offscreen.width = viewport.width;
      offscreen.height = viewport.height;

      await page.render({ canvasContext: offCtx, viewport }).promise;

      // Exact coordinates matching currentLabelBox (Flipkart Seller Hub layout)
      const { x, y, width: cw, height: ch } = currentLabelBox || FLIPKART_LABEL_BOX;

      canvas.width = Math.round(cw * cropScale);
      canvas.height = Math.round(ch * cropScale);

      const srcX = x * cropScale;
      const srcY = (a4Height - (y + ch)) * cropScale;
      const srcW = cw * cropScale;
      const srcH = ch * cropScale;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.error('Render error:', err);
    }
  }

  function getPageIndices() {
    return pagesMetadata.map((p) => p.pageIndex);
  }

  // Download Cropped Shipping Labels (PDF) - Handles both top and bottom buttons
  async function executeDownloadPdf() {
    if (!currentPdfBytes) return;

    const buttons = [btnDownloadPdf, btnTopDownloadPdf].filter(Boolean);
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = `<span>⏳ Cropping Shipping Labels...</span>`;
    });

    try {
      let outputBytes;
      if (isImageMode && currentImageCropResult) {
        outputBytes = currentImageCropResult.pdfBytes;
      } else {
        const pageIndices = getPageIndices();
        outputBytes = await cropFlipkartShippingLabels(currentPdfBytes, {
          selectedPages: pageIndices,
          labelBox: currentLabelBox,
        });
      }

      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Flipkart_Cropped_Labels_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (window.confetti) {
        window.confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.6 },
          colors: ['#2874F0', '#FFE500', '#FB641B'],
        });
      }
    } catch (err) {
      console.error(err);
      showToast('Error cropping PDF: ' + err.message, 'error');
    } finally {
      buttons.forEach((btn) => {
        btn.disabled = false;
        if (btn.dataset.originalHtml) {
          btn.innerHTML = btn.dataset.originalHtml;
        }
      });
    }
  }

  if (btnDownloadPdf) btnDownloadPdf.addEventListener('click', executeDownloadPdf);
  if (btnTopDownloadPdf) btnTopDownloadPdf.addEventListener('click', executeDownloadPdf);

  // Direct Print
  if (btnDirectPrint) {
    btnDirectPrint.addEventListener('click', async () => {
      if (!currentPdfBytes) return;

      btnDirectPrint.disabled = true;
      const origText = btnDirectPrint.innerHTML;
      btnDirectPrint.innerHTML = `<span>⏳ Preparing Print...</span>`;

      try {
        let outputBytes;
        if (isImageMode && currentImageCropResult) {
          outputBytes = currentImageCropResult.pdfBytes;
        } else {
          const pageIndices = getPageIndices();
          outputBytes = await cropFlipkartShippingLabels(currentPdfBytes, {
            selectedPages: pageIndices,
            labelBox: currentLabelBox,
          });
        }

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
          btnDirectPrint.disabled = false;
          btnDirectPrint.innerHTML = origText;
          printIframe.contentWindow.focus();
          printIframe.contentWindow.print();
        };

        document.body.appendChild(printIframe);
      } catch (err) {
        console.error(err);
        showToast('Could not start direct print: ' + err.message + '. Please use "Download 4x6 PDF" instead.', 'error');
        btnDirectPrint.disabled = false;
        btnDirectPrint.innerHTML = origText;
      }
    });
  }

  // Download Separate Invoices
  if (btnDownloadInvoices) {
    btnDownloadInvoices.addEventListener('click', async () => {
      if (!currentPdfBytes || isImageMode) return;

      btnDownloadInvoices.disabled = true;
      const origText = btnDownloadInvoices.innerHTML;
      btnDownloadInvoices.innerHTML = `<span>⏳ Extracting Invoices...</span>`;

      try {
        const pageIndices = getPageIndices();
        const outputBytes = await extractFlipkartInvoices(currentPdfBytes, {
          selectedPages: pageIndices,
        });

        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Flipkart_Invoices_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error(err);
        showToast('Error extracting invoices: ' + err.message, 'error');
      } finally {
        btnDownloadInvoices.disabled = false;
        btnDownloadInvoices.innerHTML = origText;
      }
    });
  }

  // Download Cropped Image (PNG)
  if (btnDownloadPng) {
    btnDownloadPng.addEventListener('click', () => {
      if (!currentImageCropResult || !currentImageCropResult.pngBlob) return;
      const url = URL.createObjectURL(currentImageCropResult.pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Flipkart_Cropped_Label_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
