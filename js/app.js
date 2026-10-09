/**
 * QuickCrop - Flipkart Shipping Label App Controller
 * Handles PDF & Image uploads, vector cropping, instant preview, pagination, and printing
 */

(function () {
  'use strict';

  const UI = window.QuickCropUI;

  // Global State
  let currentPdfBytes = null;
  let currentPdfDocProxy = null;
  let pagesMetadata = [];
  let currentPage = 1;
  let currentLabelBox = FLIPKART_LABEL_BOX;

  let currentImageCropResult = null;
  let isImageMode = false;
  let currentMarketplace = 'flipkart';
  const defaultDocTitle = document.title;

  // Shared reusable offscreen canvas to prevent memory allocations on frame render
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
  const btnDirectPrint = document.getElementById('btn-direct-print');
  const btnDownloadInvoices = document.getElementById('btn-download-invoices');
  const btnDownloadPng = document.getElementById('btn-download-png');

  // Initialize Error Card Listeners
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

  // Setup Drag & Drop
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
      pagesMetadata = [];
      currentImageCropResult = null;
      isImageMode = false;
      currentLabelBox = FLIPKART_LABEL_BOX;
      if (fileInput) fileInput.value = '';
      UI.setActiveDocTitle(defaultDocTitle);
      UI.hideLoading();
      UI.hideError();
      if (resultCard) resultCard.style.display = 'none';
      if (uploadArea) uploadArea.style.display = 'block';
    });
  }

  // Tab Title Visibility
  UI.bindVisibilityTitle(() => (pagesMetadata ? pagesMetadata.length : 0), 'Flipkart');

  // Load and validate selected file
  async function loadSelectedFile(file) {
    UI.hideError();
    if (!file) return;

    if (file.size === 0) {
      UI.showError('Empty File Selected', 'The selected file has 0 bytes. Please ensure the file downloaded completely from Flipkart Seller Hub.');
      return;
    }

    if (file.size > 80 * 1024 * 1024) {
      UI.showError('File Exceeds Size Limit', `The file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Shipping label files are normally under 15 MB.`);
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
        `"${file.name}" is not a supported format. Please upload an official shipping label PDF (.pdf) or image (.png, .jpg, .webp).`
      );
    }
  }

  // Process PDF Buffer
  async function processPdfBuffer(buffer, fileName) {
    try {
      UI.showLoading('Processing Shipping Labels...', 'Analyzing document pages and isolating shipping labels...', 'Reading PDF streams...', fileName);

      if (!buffer || buffer.byteLength === 0) {
        UI.showError('Empty PDF Document', 'The uploaded PDF file contains no data. Please re-download the label from Seller Hub.');
        return;
      }

      // Clone buffer so worker transfer never detaches currentPdfBytes!
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
      UI.updateLoadingProgress(`Reading 1 of ${totalPages} pages...`, 15);

      // Auto-detect marketplace from page 1 text stream
      let isAmazonDoc = false;
      try {
        const page1 = await currentPdfDocProxy.getPage(1);
        const p1TextContent = await page1.getTextContent();
        const p1FullText = p1TextContent.items.map((it) => it.str).join(' ');
        isAmazonDoc =
          /amazon|ATSPL|Tax Invoice\/Bill of Supply|Cash Memo/i.test(p1FullText) ||
          (p1FullText.includes('Order Id') && p1FullText.includes('AWB') && p1FullText.includes('DELIVERY STATION'));
      } catch (detectErr) {
        console.warn('Marketplace detect error:', detectErr);
      }

      if (isAmazonDoc) {
        currentMarketplace = 'amazon';
        pagesMetadata = await parseAmazonPdfMetadata(currentPdfDocProxy, (current, total) => {
          const pct = Math.round(15 + (current / total) * 75);
          UI.updateLoadingProgress(`Scanning Amazon order ${current} of ${total}...`, pct);
        });
      } else {
        currentMarketplace = 'flipkart';
        pagesMetadata = await parsePdfMetadata(currentPdfDocProxy, (current, total) => {
          const pct = Math.round(15 + (current / total) * 75);
          UI.updateLoadingProgress(`Scanning Flipkart order ${current} of ${total}...`, pct);
        });
      }

      if (!pagesMetadata || pagesMetadata.length === 0) {
        UI.showError('No Orders Detected', 'Could not detect any shipping orders in this PDF. Please ensure this is an official shipping label document.');
        return;
      }

      // Group & sort multi-order batches by SKU
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

      UI.updateLoadingProgress('Formatting thermal label preview...', 95);

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
        const brand = currentMarketplace === 'amazon' ? 'Amazon ' : 'Flipkart ';
        orderCountDisplay.textContent = `${pagesMetadata.length} ${brand}Order${pagesMetadata.length > 1 ? 's' : ''} Ready${isGrouped ? ' (Grouped by SKU)' : ''}`;
        UI.setActiveDocTitle(`✅ (${pagesMetadata.length} ${brand}Orders Ready) - QuickCrop`);
      }

      if (btnDownloadInvoices) btnDownloadInvoices.style.display = 'inline-flex';
      if (btnDownloadPng) btnDownloadPng.style.display = 'none';

      UI.hideLoading();
      if (resultCard) resultCard.style.display = 'block';

      currentPage = 1;
      updatePaginationUI();
      renderCurrentPage();

      if (resultCard) resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Processing error:', err);
      UI.showError('Error Processing PDF', (err.message || 'An unexpected error occurred while analyzing the PDF.') + ' Please verify the file and try again.');
    }
  }

  // Process Image File
  async function processImageFile(file) {
    try {
      UI.showLoading('Processing Label Image...', 'Extracting Flipkart shipping label from image...', 'Cropping label...', file.name);

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

      if (canvas) {
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(result.canvas, 0, 0);
      }

      if (orderMetaDisplay) {
        orderMetaDisplay.textContent = '100% Cropped Shipping Label';
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

  // Render Cropped Label on Canvas (Memory-optimized with shared offscreen canvas)
  async function renderCurrentPage() {
    if (isImageMode) return;
    if (!currentPdfDocProxy || !canvas) return;

    const meta = pagesMetadata[currentPage - 1];
    if (meta && orderMetaDisplay) {
      const skuText = meta.sku && meta.sku !== 'General Product' && meta.sku !== 'General Item' && meta.sku !== 'General SKU' ? ` • SKU: ${meta.sku}` : '';
      const stationText = meta.station ? ` [${meta.station}]` : '';
      orderMetaDisplay.textContent = `${meta.orderId} • ${meta.courier}${stationText}${skuText}`;
    }

    try {
      if (!sharedOffscreenCanvas) {
        sharedOffscreenCanvas = document.createElement('canvas');
      }

      if (currentMarketplace === 'amazon') {
        const sourcePageNum = typeof meta.sourcePageIndex === 'number' ? meta.sourcePageIndex + 1 : currentPage;
        const page = await currentPdfDocProxy.getPage(sourcePageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const a4Height = viewport.height || 841.89;
        const previewScale = 2.0;

        const offscreen = sharedOffscreenCanvas;
        const offCtx = offscreen.getContext('2d');
        const renderViewport = page.getViewport({ scale: previewScale });

        offscreen.width = renderViewport.width;
        offscreen.height = renderViewport.height;
        await page.render({ canvasContext: offCtx, viewport: renderViewport }).promise;

        const box = meta.labelBox || AMAZON_LABEL_BOX_2UP_TOP;
        const targetCanvasW = Math.round(288 * (previewScale / 1.5));
        const targetCanvasH = Math.round(432 * (previewScale / 1.5));

        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const srcX = box.x * previewScale;
        const srcY = (a4Height - (box.y + box.height)) * previewScale;
        const srcW = box.width * previewScale;
        const srcH = box.height * previewScale;

        const scaleFit = Math.min((targetCanvasW - 12) / srcW, (targetCanvasH - 12) / srcH);
        const destW = srcW * scaleFit;
        const destH = srcH * scaleFit;
        const destX = (targetCanvasW - destW) / 2;
        const destY = (targetCanvasH - destH) / 2;

        ctx.drawImage(offscreen, srcX, srcY, srcW, srcH, destX, destY, destW, destH);

        if (meta.sku && meta.sku !== 'General Item') {
          ctx.fillStyle = '#000000';
          ctx.font = 'bold 13px Inter, sans-serif';
          const qtyPart = meta.qty ? ` | Qty - ${meta.qty}` : '';
          const stampText = `${meta.sku}${qtyPart}`;
          const stampX = destX + 16 * (destW / box.width);
          const stampY = destY + destH - 72 * (destH / box.height);
          ctx.fillText(stampText, stampX, stampY);
        }
      } else {
        const sourcePageNum = meta ? (meta.pageIndex + 1) : currentPage;
        const page = await currentPdfDocProxy.getPage(sourcePageNum);
        const a4Height = 841.89;
        const cropScale = 1.6;

        const offscreen = sharedOffscreenCanvas;
        const offCtx = offscreen.getContext('2d');
        const viewport = page.getViewport({ scale: cropScale });

        offscreen.width = viewport.width;
        offscreen.height = viewport.height;

        await page.render({ canvasContext: offCtx, viewport }).promise;

        const activeBox = (meta && meta.labelBox) ? meta.labelBox : (currentLabelBox || FLIPKART_LABEL_BOX);
        const { x, y, width: cw, height: ch } = activeBox;

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
      }
    } catch (err) {
      console.error('Render error:', err);
    }
  }

  function getPageIndices() {
    return pagesMetadata.map((p) => p.pageIndex);
  }

  // Generate Cropped PDF Bytes
  async function generateCroppedPdfBytes() {
    if (isImageMode && currentImageCropResult) {
      return currentImageCropResult.pdfBytes;
    } else if (currentMarketplace === 'amazon') {
      return await cropAmazonShippingLabels(currentPdfBytes, {
        orders: pagesMetadata,
        stampSku: true,
      });
    } else {
      const pageIndices = getPageIndices();
      return await cropFlipkartShippingLabels(currentPdfBytes, {
        selectedPages: pageIndices,
        orders: pagesMetadata,
        labelBox: currentLabelBox,
      });
    }
  }

  // Download Cropped Shipping Labels (PDF)
  async function executeDownloadPdf() {
    if (!currentPdfBytes) return;

    const buttons = [btnDownloadPdf, btnTopDownloadPdf].filter(Boolean);
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.dataset.originalHtml = btn.innerHTML;
      btn.innerHTML = `<span>⏳ Cropping Shipping Labels...</span>`;
    });

    try {
      let downloadFileName = `Cropped_Labels_${Date.now()}.pdf`;
      let confettiColors = ['#2874F0', '#FFE500', '#FB641B'];

      if (isImageMode) {
        downloadFileName = `Cropped_Label_${Date.now()}.pdf`;
      } else if (currentMarketplace === 'amazon') {
        downloadFileName = `Amazon_Cropped_Labels_${Date.now()}.pdf`;
        confettiColors = ['#FF9900', '#131921', '#232F3E', '#FFFFFF'];
      } else {
        downloadFileName = `Flipkart_Cropped_Labels_${Date.now()}.pdf`;
      }

      const outputBytes = await generateCroppedPdfBytes();
      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = downloadFileName;
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
          colors: confettiColors,
        });
      }
    } catch (err) {
      console.error(err);
      UI.showToast('Error cropping PDF: ' + err.message, 'error');
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

  // Direct Print using QuickCropUI performDirectPrint (Memory Leak Free)
  if (btnDirectPrint) {
    btnDirectPrint.addEventListener('click', () => {
      if (!currentPdfBytes) return;
      UI.performDirectPrint(generateCroppedPdfBytes, btnDirectPrint, 'Labels');
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
        let outputBytes;
        let invoiceFileName = `Invoices_${Date.now()}.pdf`;

        if (currentMarketplace === 'amazon') {
          outputBytes = await extractAmazonInvoices(currentPdfBytes, {
            orders: pagesMetadata,
          });
          invoiceFileName = `Amazon_Invoices_${Date.now()}.pdf`;
        } else {
          const pageIndices = getPageIndices();
          outputBytes = await extractFlipkartInvoices(currentPdfBytes, {
            selectedPages: pageIndices,
          });
          invoiceFileName = `Flipkart_Invoices_${Date.now()}.pdf`;
        }

        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = invoiceFileName;
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
      a.download = `Flipkart_Cropped_Label_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
})();
