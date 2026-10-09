/**
 * QuickCrop - Amazon Shipping Label App Controller
 * Simple Odd-Page Label Filtering & Direct PDF Extraction (Odd Pages = Labels, Even Pages = Invoices)
 */

(function () {
  'use strict';

  const UI = window.QuickCropUI;

  // Global State
  let currentPdfBytes = null;
  let currentPdfDocProxy = null;
  let ordersMetadata = [];
  let currentOrderIndex = 0;

  let currentImageCropResult = null;
  let isImageMode = false;
  const defaultDocTitle = document.title;

  // Shared reusable offscreen canvas
  let sharedOffscreenCanvas = null;

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

  const cropperErrorCard = document.getElementById('cropper-error-card');
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
  const btnDownloadInvoices = document.getElementById('btn-download-invoices');
  const btnDownloadPng = document.getElementById('btn-download-png');

  // Error Card Actions
  if (btnErrorRetry) {
    btnErrorRetry.addEventListener('click', () => {
      UI.hideError();
      if (fileInput) fileInput.click();
    });
  }

  if (btnErrorDismiss) {
    btnErrorDismiss.addEventListener('click', () => {
      UI.hideError();
    });
  }

  // Drag & Drop
  UI.setupDropzone(dropzone, fileInput, (file) => loadSelectedFile(file));
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
      UI.setActiveDocTitle(defaultDocTitle);
      UI.hideLoading();
      UI.hideError();
      if (resultCard) resultCard.style.display = 'none';
      if (uploadArea) uploadArea.style.display = 'block';
    });
  }

  // Tab Title Visibility
  UI.bindVisibilityTitle(() => (ordersMetadata ? ordersMetadata.length : 0), 'Amazon');

  // Load and validate selected file
  async function loadSelectedFile(file) {
    UI.hideError();
    if (!file) return;

    if (file.size === 0) {
      UI.showError('Empty File Selected', 'The selected file has 0 bytes. Please ensure the file downloaded completely from Amazon Seller Central.');
      return;
    }

    if (file.size > 80 * 1024 * 1024) {
      UI.showError('File Exceeds Size Limit', `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Amazon shipping label files are normally under 15 MB.`);
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
        UI.showError('File Access Error', 'Could not read file from your device. Please try selecting the file again.');
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
      UI.showError(
        'Unsupported File Format',
        `"${file.name}" is not a supported format. Please upload an official Amazon Seller shipping label PDF (.pdf) or image (.png, .jpg, .webp).`
      );
    }
  }

  // Process Amazon PDF Buffer (Extract Odd-numbered Label Pages)
  async function processPdfBuffer(buffer, fileName) {
    try {
      UI.showLoading('Processing Amazon Shipping Labels...', 'Filtering odd-numbered shipping label pages from even-numbered invoices...', 'Reading PDF streams...', fileName);

      if (!buffer || buffer.byteLength === 0) {
        UI.showError('Empty PDF Document', 'The uploaded PDF file contains no data. Please re-download the label from Amazon Seller Central.');
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
          UI.showError('Password Protected PDF', 'This PDF is encrypted with a password. QuickCrop cannot process locked documents.');
          return;
        }
        if (pdfJsErr.name === 'InvalidPDFException' || (pdfJsErr.message && pdfJsErr.message.toLowerCase().includes('invalid pdf'))) {
          UI.showError('Corrupted PDF File', 'This file is corrupted or not a recognized PDF document.');
          return;
        }
        UI.showError('Unable to Open PDF', 'Failed to parse the PDF document: ' + (pdfJsErr.message || 'Unknown PDF error'));
        return;
      }

      if (!currentPdfDocProxy || currentPdfDocProxy.numPages === 0) {
        UI.showError('Empty Document', 'The uploaded PDF document contains 0 pages.');
        return;
      }

      const totalPages = currentPdfDocProxy.numPages;
      UI.updateLoadingProgress(`Reading ${totalPages} pages...`, 20);

      // Build metadata list for odd pages (Page 1, 3, 5, 7...)
      ordersMetadata = [];
      const totalLabelCount = totalPages <= 1 ? 1 : Math.ceil(totalPages / 2);

      for (let i = 0; i < totalLabelCount; i++) {
        const oddPageIndex = totalPages <= 1 ? 0 : i * 2;
        const pageNum = oddPageIndex + 1;

        let orderId = `Amazon Label (Page ${pageNum})`;
        let courier = 'Amazon Easy Ship';
        let sku = '';

        try {
          const page = await currentPdfDocProxy.getPage(pageNum);
          const textContent = await page.getTextContent();
          const fullText = textContent.items.map((it) => it.str).join(' ');

          const orderIdMatch = fullText.match(/([0-9]{3}-[0-9]{7}-[0-9]{7})/) || fullText.match(/Order\s*Id:?\s*([0-9A-Z\-]+)/i);
          if (orderIdMatch) {
            orderId = orderIdMatch[1] || orderIdMatch[0];
          }

          if (fullText.includes('ATSPL')) courier = 'ATSPL';
          else if (fullText.includes('Delhivery')) courier = 'Delhivery';
          else if (fullText.includes('Blue Dart')) courier = 'Blue Dart';
        } catch (e) {
          console.warn('Page text read warning:', e);
        }

        ordersMetadata.push({
          orderIndex: i,
          orderId,
          courier,
          sku,
          sourcePageIndex: oddPageIndex,
          invoicePageIndex: oddPageIndex + 1 < totalPages ? oddPageIndex + 1 : null,
        });
      }

      UI.updateLoadingProgress('Formatting preview...', 95);

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
        let countLabel = `${ordersMetadata.length} Amazon Shipping Label${ordersMetadata.length > 1 ? 's' : ''} Ready`;
        if (totalPages > 1) {
          countLabel += ` (Odd Pages 1, 3, 5... Isolated • Even Invoices Separated)`;
        }
        orderCountDisplay.textContent = countLabel;
        UI.setActiveDocTitle(`✅ (${ordersMetadata.length} Amazon Labels Ready) - QuickCrop`);
      }

      if (btnDownloadInvoices) btnDownloadInvoices.style.display = totalPages > 1 ? 'inline-flex' : 'none';
      if (btnDownloadPng) btnDownloadPng.style.display = 'none';

      UI.hideLoading();
      if (resultCard) resultCard.style.display = 'block';

      currentOrderIndex = 0;
      updatePaginationUI();
      await renderCurrentOrderPreview();

      if (resultCard) resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Amazon processing error:', err);
      UI.showError('Error Processing Amazon PDF', (err.message || 'An unexpected error occurred while analyzing the PDF.') + ' Please verify the file and try again.');
    }
  }

  // Process Image File
  async function processImageFile(file) {
    try {
      UI.showLoading('Processing Label Image...', 'Extracting Amazon shipping label from image...', 'Cropping label...', file.name);

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

      if (canvas) {
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(result.canvas, 0, 0);
      }

      if (orderMetaDisplay) {
        orderMetaDisplay.textContent = '100% Cropped Amazon Shipping Label';
      }

      UI.hideLoading();
      if (resultCard) {
        resultCard.style.display = 'block';
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.error('Image crop error:', err);
      UI.showError('Image Processing Error', 'Could not crop the shipping label from this image: ' + (err.message || 'Image decode failed'));
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
      if (pageIndicator) pageIndicator.textContent = `Label ${currentOrderIndex + 1} of ${ordersMetadata.length}${pageInfo}`;
      if (prevPageBtn) prevPageBtn.disabled = currentOrderIndex <= 0;
      if (nextPageBtn) nextPageBtn.disabled = currentOrderIndex >= ordersMetadata.length - 1;
    }
  }

  // Render Label Preview (Render odd-numbered page directly)
  async function renderCurrentOrderPreview() {
    if (isImageMode) return;
    if (!currentPdfDocProxy || !canvas || ordersMetadata.length === 0) return;

    const order = ordersMetadata[currentOrderIndex];
    if (!order) return;

    if (orderMetaDisplay) {
      const pageText = typeof order.sourcePageIndex === 'number' ? ` • Page ${order.sourcePageIndex + 1}` : '';
      orderMetaDisplay.textContent = `${order.orderId} • ${order.courier}${pageText}`;
    }

    try {
      if (!sharedOffscreenCanvas) {
        sharedOffscreenCanvas = document.createElement('canvas');
      }

      const pageNum = order.sourcePageIndex + 1;
      const page = await currentPdfDocProxy.getPage(pageNum);
      const renderScale = 1.5;
      const viewport = page.getViewport({ scale: renderScale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) {
      console.error('Amazon render error:', err);
    }
  }

  // Generate Shipping Labels PDF (Odd pages)
  async function generateCroppedPdfBytes() {
    if (isImageMode && currentImageCropResult) {
      return currentImageCropResult.pdfBytes;
    } else {
      return await cropAmazonShippingLabels(currentPdfBytes, {
        orders: ordersMetadata,
      });
    }
  }

  // Download Amazon Shipping Labels PDF
  async function executeDownloadPdf() {
    if (!currentPdfBytes) return;

    const buttons = [btnDownloadPdf, btnTopDownloadPdf].filter(Boolean);
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = `<span>⏳ Extracting Labels PDF...</span>`;
    });

    try {
      const outputBytes = await generateCroppedPdfBytes();
      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `Amazon_Shipping_Labels_${Date.now()}.pdf`;
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
      UI.showToast('Error generating Amazon PDF: ' + err.message, 'error');
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

  // Download Separate Invoices (Even pages: 2, 4, 6...)
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
        UI.showToast('Error extracting invoices: ' + err.message, 'error');
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
      a.download = `Amazon_Label_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
