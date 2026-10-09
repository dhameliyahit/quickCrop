/**
 * QuickCrop - Amazon Shipping Label App Controller
 * Pure Vector Form XObject Cropping, SKU & Qty Stamping, Live Canvas Preview,
 * Multi-Order Batching, and Direct Thermal Printing
 */

(function () {
  'use strict';

  // Global State
  let currentPdfBytes = null;
  let currentPdfDocProxy = null;
  let ordersMetadata = [];
  let currentOrderIndex = 0;

  let currentImageCropResult = null;
  let isImageMode = false;
  const defaultDocTitle = document.title;
  let activeDocTitle = defaultDocTitle;

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
  const chkStampSku = document.getElementById('chk-stamp-sku');

  // Error State Display
  function showError(title, desc) {
    hideLoading();
    if (resultCard) resultCard.style.display = 'none';
    if (uploadArea) uploadArea.style.display = 'block';

    if (cropperErrorCard) {
      if (cropperErrorTitle) cropperErrorTitle.textContent = title || 'Unable to Process Label File';
      if (cropperErrorDesc) cropperErrorDesc.textContent = desc || 'Please ensure this is a valid Amazon Easy Ship or Self Ship order PDF/image.';
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
    document.title = '⏳ Processing Amazon Labels... — QuickCrop';
    if (loadingState) {
      loadingState.style.display = 'block';
      if (loadingTitle) loadingTitle.textContent = title || 'Processing Amazon Shipping Labels...';
      if (loadingDesc) loadingDesc.textContent = desc || 'Scanning A4 pages, isolating thermal label boundaries, and extracting SKUs.';
      if (loadingStatus) loadingStatus.textContent = status || 'Reading PDF vector streams...';

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

  // Error Card Actions
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

  // Reset / Change File
  if (changeFileBtn) {
    changeFileBtn.addEventListener('click', () => {
      currentPdfBytes = null;
      currentPdfDocProxy = null;
      ordersMetadata = [];
      currentOrderIndex = 0;
      currentImageCropResult = null;
      isImageMode = false;
      if (fileInput) fileInput.value = '';
      activeDocTitle = defaultDocTitle;
      document.title = defaultDocTitle;
      hideLoading();
      hideError();
      resultCard.style.display = 'none';
      uploadArea.style.display = 'block';
    });
  }

  // Dynamic tab title visibility handler
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (ordersMetadata && ordersMetadata.length > 0) {
        document.title = `📦 (${ordersMetadata.length} Orders Ready) Print Amazon Labels — QuickCrop`;
      } else {
        document.title = '⚡ Free Amazon Easy Ship Label Cropper — QuickCrop';
      }
    } else {
      document.title = activeDocTitle;
    }
  });

  // Toggle SKU stamping re-render
  if (chkStampSku) {
    chkStampSku.addEventListener('change', () => {
      renderCurrentOrderPreview();
    });
  }

  // Load and validate selected file
  async function loadSelectedFile(file) {
    hideError();
    if (!file) return;

    if (file.size === 0) {
      showError('Empty File Selected', 'The selected file has 0 bytes. Please ensure the file downloaded completely from Amazon Seller Central.');
      return;
    }

    if (file.size > 80 * 1024 * 1024) {
      showError('File Exceeds Size Limit', `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Amazon shipping label files are normally under 15 MB.`);
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
        `"${file.name}" is not a supported format. Please upload an official Amazon Seller shipping label PDF (.pdf) or image (.png, .jpg, .webp).`
      );
    }
  }

  // Process Amazon PDF Buffer
  async function processPdfBuffer(buffer, fileName) {
    try {
      showLoading('Processing Amazon Shipping Labels...', 'Scanning A4 pages and separating labels from invoices...', 'Reading PDF streams...', fileName);

      if (!buffer || buffer.byteLength === 0) {
        showError('Empty PDF Document', 'The uploaded PDF file contains no data. Please re-download the label from Amazon Seller Central.');
        return;
      }

      // Clone buffer to prevent worker detachment
      const cleanBuffer = buffer.slice(0);
      currentPdfBytes = new Uint8Array(cleanBuffer);
      currentImageCropResult = null;
      isImageMode = false;

      // Load with PDF.js
      const pdfJsBuffer = buffer.slice(0);
      try {
        currentPdfDocProxy = await loadPdfDoc(pdfJsBuffer);
      } catch (pdfJsErr) {
        console.error('PDF.js parse error:', pdfJsErr);
        if (pdfJsErr.name === 'PasswordException' || (pdfJsErr.message && pdfJsErr.message.toLowerCase().includes('password'))) {
          showError('Password Protected PDF', 'This PDF is encrypted with a password. QuickCrop cannot process locked documents. Please remove the password or download the unencrypted label PDF directly from Amazon.');
          return;
        }
        if (pdfJsErr.name === 'InvalidPDFException' || (pdfJsErr.message && pdfJsErr.message.toLowerCase().includes('invalid pdf'))) {
          showError('Corrupted PDF File', 'This file is corrupted or not a recognized PDF document. Please verify the file or re-download it from Amazon Seller Central.');
          return;
        }
        showError('Unable to Open PDF', 'Failed to parse the PDF document: ' + (pdfJsErr.message || 'Unknown PDF error') + '. Please ensure this is a standard Amazon shipping label PDF.');
        return;
      }

      if (!currentPdfDocProxy || currentPdfDocProxy.numPages === 0) {
        showError('Empty Document', 'The uploaded PDF document contains 0 pages.');
        return;
      }

      const totalPages = currentPdfDocProxy.numPages;
      updateLoadingProgress(`Reading 1 of ${totalPages} pages...`, 15);

      ordersMetadata = await parseAmazonPdfMetadata(currentPdfDocProxy, (current, total) => {
        const pct = Math.round(15 + (current / total) * 75);
        updateLoadingProgress(`Analyzing order page ${current} of ${total}...`, pct);
      });

      if (!ordersMetadata || ordersMetadata.length === 0) {
        showError('No Orders Detected', 'Could not detect any Amazon shipping labels in this PDF. Please ensure this is an official Amazon Easy Ship or Self Ship label document.');
        return;
      }

      // Automatically group and sort multi-order batches by SKU for consecutive packing
      if (ordersMetadata.length > 1) {
        ordersMetadata.sort((a, b) => {
          const skuA = (a.sku || '').toLowerCase().trim();
          const skuB = (b.sku || '').toLowerCase().trim();
          if (skuA && skuB && skuA !== skuB) {
            return skuA.localeCompare(skuB, undefined, { numeric: true, sensitivity: 'base' });
          }
          return a.orderIndex - b.orderIndex;
        });
      }

      updateLoadingProgress('Formatting 4x6 thermal preview...', 95);

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
        const isAlternating = ordersMetadata.some((o) => o.mode === 'alternating-pages');
        let countLabel = `${ordersMetadata.length} Order${ordersMetadata.length > 1 ? 's' : ''} Ready`;
        if (isAlternating && totalPages > ordersMetadata.length) {
          countLabel += ` (Odd Pages 1, 3, 5... Extracted • Invoices Separated)`;
        } else if (ordersMetadata.length > 1) {
          countLabel += ' (Grouped by SKU)';
        }
        orderCountDisplay.textContent = countLabel;
        activeDocTitle = `✅ (${ordersMetadata.length} Amazon Orders Ready) - QuickCrop`;
        document.title = activeDocTitle;
      }

      if (btnDownloadInvoices) btnDownloadInvoices.style.display = 'inline-flex';
      if (btnDownloadPng) btnDownloadPng.style.display = 'none';

      hideLoading();
      resultCard.style.display = 'block';

      currentOrderIndex = 0;
      updatePaginationUI();
      await renderCurrentOrderPreview();

      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Amazon processing error:', err);
      showError('Error Processing Amazon PDF', (err.message || 'An unexpected error occurred while analyzing the PDF.') + ' Please verify the file and try again.');
    }
  }

  // Process Image File
  async function processImageFile(file) {
    try {
      showLoading('Processing Label Image...', 'Extracting Amazon shipping label from image...', 'Cropping label...', file.name);

      const result = await cropAmazonLabelImage(file);
      currentImageCropResult = result;
      currentPdfBytes = result.pdfBytes;
      ordersMetadata = [
        {
          orderIndex: 0,
          orderId: 'Cropped Label Image',
          courier: 'Amazon Easy Ship',
          sku: 'Amazon Order',
          qty: 1,
          sourcePageIndex: 0,
          labelBox: AMAZON_LABEL_BOX_2UP_TOP,
        },
      ];

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
        orderMetaDisplay.textContent = '100% Cropped Amazon Shipping Label';
      }

      hideLoading();
      resultCard.style.display = 'block';
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Image crop error:', err);
      showError('Image Processing Error', 'Could not crop the shipping label from this image: ' + (err.message || 'Image decode failed') + '. Please ensure the image clearly displays the Amazon shipping label.');
    }
  }

  // Stepper Listeners
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentOrderIndex > 0) {
        currentOrderIndex--;
        updatePaginationUI();
        renderCurrentOrderPreview();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentOrderIndex < ordersMetadata.length - 1) {
        currentOrderIndex++;
        updatePaginationUI();
        renderCurrentOrderPreview();
      }
    });
  }

  function updatePaginationUI() {
    if (!stepperRow) return;
    if (ordersMetadata.length <= 1) {
      stepperRow.style.display = 'none';
    } else {
      stepperRow.style.display = 'flex';
      const order = ordersMetadata[currentOrderIndex];
      const pageInfo = order && typeof order.sourcePageIndex === 'number' ? ` (Page ${order.sourcePageIndex + 1})` : '';
      if (pageIndicator) pageIndicator.textContent = `Order ${currentOrderIndex + 1} of ${ordersMetadata.length}${pageInfo}`;
      if (prevPageBtn) prevPageBtn.disabled = currentOrderIndex <= 0;
      if (nextPageBtn) nextPageBtn.disabled = currentOrderIndex >= ordersMetadata.length - 1;
    }
  }

  // Render Cropped Label on Canvas with Optional SKU Overlay
  async function renderCurrentOrderPreview() {
    if (isImageMode) return;
    if (!currentPdfDocProxy || !canvas || ordersMetadata.length === 0) return;

    const order = ordersMetadata[currentOrderIndex];
    if (!order) return;

    if (orderMetaDisplay) {
      const skuText = order.sku && order.sku !== 'Amazon Item' && order.sku !== 'General Item' && order.sku !== 'Amazon Order' ? ` • SKU: ${order.sku} (Qty: ${order.qty || 1})` : '';
      const stationText = order.station ? ` [${order.station}]` : '';
      const pageText = typeof order.sourcePageIndex === 'number' ? ` • Page ${order.sourcePageIndex + 1}` : '';
      orderMetaDisplay.textContent = `${order.orderId} • ${order.courier}${stationText}${skuText}${pageText}`;
    }

    try {
      const page = await currentPdfDocProxy.getPage(order.sourcePageIndex + 1);
      const viewport = page.getViewport({ scale: 1.0 });
      const a4Height = viewport.height || 841.89;
      const previewScale = 2.0;

      const offscreen = document.createElement('canvas');
      const offCtx = offscreen.getContext('2d');
      const renderViewport = page.getViewport({ scale: previewScale });

      offscreen.width = renderViewport.width;
      offscreen.height = renderViewport.height;

      await page.render({ canvasContext: offCtx, viewport: renderViewport }).promise;

      // Output canvas aspect ratio 4x6 (288x432 pt)
      const targetCanvasW = Math.round(288 * (previewScale / 1.5));
      const targetCanvasH = Math.round(432 * (previewScale / 1.5));

      canvas.width = targetCanvasW;
      canvas.height = targetCanvasH;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const box = order.labelBox || (viewport.width > 500 ? AMAZON_LABEL_BOX_2UP_TOP : null);

      if (box) {
        // Extract coordinates from box
        const cropW = box.width;
        const cropH = box.height;

        // PDF coordinate conversion: (0,0) is bottom-left
        const srcX = box.x * previewScale;
        const srcY = (a4Height - (box.y + cropH)) * previewScale;
        const srcW = cropW * previewScale;
        const srcH = cropH * previewScale;

        // Draw centered within 4x6 canvas
        const scaleFit = Math.min((targetCanvasW - 12) / srcW, (targetCanvasH - 12) / srcH);
        const destW = srcW * scaleFit;
        const destH = srcH * scaleFit;
        const destX = (targetCanvasW - destW) / 2;
        const destY = (targetCanvasH - destH) / 2;

        ctx.drawImage(offscreen, srcX, srcY, srcW, srcH, destX, destY, destW, destH);

        // Render SKU & Quantity stamp overlay if checkbox is checked
        const shouldStamp = chkStampSku ? chkStampSku.checked : true;
        if (shouldStamp && order.sku && order.sku !== 'Amazon Item' && order.sku !== 'General Item') {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 13px Inter, sans-serif';
          const qtyPart = order.qty ? ` | Qty - ${order.qty}` : '';
          const stampText = `${order.sku}${qtyPart}`;
          const stampX = destX + 16 * (destW / cropW);
          const stampY = destY + destH - 72 * (destH / cropH);
          ctx.fillText(stampText, stampX, stampY);
        }
      } else {
        // Full page label (Odd page e.g. 1, 3, 5)
        const srcW = renderViewport.width;
        const srcH = renderViewport.height;

        const scaleFit = Math.min((targetCanvasW - 16) / srcW, (targetCanvasH - 16) / srcH);
        const destW = srcW * scaleFit;
        const destH = srcH * scaleFit;
        const destX = (targetCanvasW - destW) / 2;
        const destY = (targetCanvasH - destH) / 2;

        ctx.drawImage(offscreen, 0, 0, srcW, srcH, destX, destY, destW, destH);

        // Render SKU & Quantity stamp overlay inside the whitespace gap (matches crp-amz.png)
        const shouldStamp = chkStampSku ? chkStampSku.checked : true;
        if (shouldStamp && order.sku && order.sku !== 'Amazon Item' && order.sku !== 'General Item' && order.sku !== 'Amazon Order') {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 13px Inter, sans-serif';
          const qty = order.qty || 1;
          const stampText = `${order.sku} | Qty - ${qty}`;
          const stampX = destX + destW * 0.14;
          const stampY = destY + destH - (destH * 0.165);
          ctx.fillText(stampText, stampX, stampY);
        }
      }
    } catch (err) {
      console.error('Amazon render error:', err);
    }
  }

  // Download Cropped Amazon Shipping Labels (PDF)
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
        const shouldStamp = chkStampSku ? chkStampSku.checked : true;
        outputBytes = await cropAmazonShippingLabels(currentPdfBytes, {
          orders: ordersMetadata,
          stampSku: shouldStamp,
        });
      }

      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `Amazon_Cropped_Labels_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 40000);

      if (window.confetti) {
        window.confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.6 },
          colors: ['#FF9900', '#131921', '#232F3E', '#FFFFFF'],
        });
      }
    } catch (err) {
      console.error('Amazon PDF download error:', err);
      showToast('Error cropping Amazon PDF: ' + err.message, 'error');
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
          const shouldStamp = chkStampSku ? chkStampSku.checked : true;
          outputBytes = await cropAmazonShippingLabels(currentPdfBytes, {
            orders: ordersMetadata,
            stampSku: shouldStamp,
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

  // Download Separate Invoices (PDF)
  if (btnDownloadInvoices) {
    btnDownloadInvoices.addEventListener('click', async () => {
      if (!currentPdfBytes || isImageMode) return;

      btnDownloadInvoices.disabled = true;
      const origText = btnDownloadInvoices.innerHTML;
      btnDownloadInvoices.innerHTML = `<span>⏳ Extracting Invoices...</span>`;

      try {
        const outputBytes = await extractAmazonInvoices(currentPdfBytes, {
          orders: ordersMetadata,
        });

        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Amazon_Invoices_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          if (a.parentNode) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 40000);
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
      a.download = `Amazon_Cropped_Label_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
