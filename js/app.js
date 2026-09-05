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
      resultCard.style.display = 'none';
      uploadArea.style.display = 'block';
    });
  }

  // Determine file type and delegate
  async function loadSelectedFile(file) {
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
      isImageMode = false;
      const buffer = await file.arrayBuffer();
      await processPdfBuffer(buffer, file.name);
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
      alert('Please select a valid Flipkart PDF or Image file (.pdf, .png, .jpg, .jpeg, .webp).');
    }
  }

  // Process PDF Buffer
  async function processPdfBuffer(buffer, fileName) {
    // Clone buffer so PDF.js worker transfer NEVER detaches currentPdfBytes!
    const cleanBuffer = buffer.slice(0);
    currentPdfBytes = new Uint8Array(cleanBuffer);
    currentImageCropResult = null;
    isImageMode = false;

    // Load with PDF.js using a separate clone
    const pdfJsBuffer = buffer.slice(0);
    currentPdfDocProxy = await loadPdfDoc(pdfJsBuffer);
    pagesMetadata = await parsePdfMetadata(currentPdfDocProxy);
    currentLabelBox = pagesMetadata.detectedBox || FLIPKART_LABEL_BOX;

    // Update File Banner
    if (fileNameDisplay) fileNameDisplay.textContent = fileName;
    if (fileSizeDisplay) fileSizeDisplay.textContent = (buffer.byteLength / 1024).toFixed(1) + ' KB';
    if (orderCountDisplay) {
      orderCountDisplay.textContent = `${pagesMetadata.length} Order${pagesMetadata.length > 1 ? 's' : ''} Ready`;
    }

    if (btnDownloadInvoices) btnDownloadInvoices.style.display = 'inline-flex';
    if (btnDownloadPng) btnDownloadPng.style.display = 'none';

    uploadArea.style.display = 'none';
    resultCard.style.display = 'block';

    currentPage = 1;
    updatePaginationUI();
    renderCurrentPage();

    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Process Image File
  async function processImageFile(file) {
    try {
      uploadArea.style.display = 'none';
      resultCard.style.display = 'block';
      if (fileNameDisplay) fileNameDisplay.textContent = file.name;
      if (fileSizeDisplay) fileSizeDisplay.textContent = (file.size / 1024).toFixed(1) + ' KB';
      if (orderCountDisplay) orderCountDisplay.textContent = '1 Cropped Label Ready';

      const result = await cropFlipkartLabelImage(file);
      currentImageCropResult = result;
      currentPdfBytes = result.pdfBytes;
      pagesMetadata = [{
        orderId: 'Cropped Label Image',
        courier: 'E-Kart Logistics',
        sku: 'Flipkart Order',
        pageIndex: 0,
      }];

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

      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      alert('Error processing image: ' + err.message);
      resultCard.style.display = 'none';
      uploadArea.style.display = 'block';
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
      orderMetaDisplay.textContent = `${meta.orderId} • ${meta.courier}`;
    }

    try {
      const page = await currentPdfDocProxy.getPage(currentPage);
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
      alert('Error cropping PDF: ' + err.message);
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
        alert('Could not start print: ' + err.message);
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
        alert('Error extracting invoices: ' + err.message);
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
