/**
 * QuickCrop - Flipkart Shipping Label Cropping Engine
 * Pure Vector CropBox & MediaBox Extraction (Zero Blur, 100% Barcode Sharpness)
 * Supports both Vector PDF files and Image inputs (PNG, JPG, WebP)
 */

// Flipkart shipping label on standard seller hub A4 sheet
// Exactly matches Flipkart Seller Hub layout: [165, 460, 430, 820] (width: 265, height: 360)
const FLIPKART_LABEL_BOX_RIGHT = {
  x: 165,      // Left coordinate of shipping label
  y: 460,      // Bottom coordinate (above dashed cut line)
  width: 265,  // Label box width (right edge at 430 on 595.28 A4)
  height: 360, // Label box height (top edge at 820 on 841.89 A4)
};

const FLIPKART_LABEL_BOX_LEFT = {
  x: 15,
  y: 460,
  width: 265,
  height: 360,
};

// Default to standard right-aligned Flipkart layout
const FLIPKART_LABEL_BOX = FLIPKART_LABEL_BOX_RIGHT;

// Flipkart invoice box on bottom of A4 sheet (extended height to 515 to capture entire top header and prevent clipping)
const FLIPKART_INVOICE_BOX = {
  x: 0,
  y: 0,
  width: 595.28,
  height: 515,
};

/**
 * Crops Flipkart Shipping Labels from multi-page or single-page PDF files
 * Preserves 100% vector sharpness for thermal barcode printers
 */
async function cropFlipkartShippingLabels(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPageCount();
  const pageIndices = options.selectedPages || Array.from({ length: totalPages }, (_, i) => i);
  const orders = options.orders || options.pagesMetadata || null;

  for (let idx = 0; idx < pageIndices.length; idx++) {
    const pageIdx = pageIndices[idx];
    if (pageIdx >= totalPages) continue;

    const [page] = await outDoc.copyPages(srcDoc, [pageIdx]);

    let targetBox = options.labelBox || FLIPKART_LABEL_BOX;
    if (orders && orders[idx] && orders[idx].labelBox) {
      targetBox = orders[idx].labelBox;
    } else if (orders && orders[pageIdx] && orders[pageIdx].labelBox) {
      targetBox = orders[pageIdx].labelBox;
    }

    page.setCropBox(
      targetBox.x,
      targetBox.y,
      targetBox.width,
      targetBox.height
    );
    page.setMediaBox(
      targetBox.x,
      targetBox.y,
      targetBox.width,
      targetBox.height
    );

    outDoc.addPage(page);
  }

  return await outDoc.save();
}

/**
 * Extracts Only Tax Invoices (bottom portion of Flipkart order pages)
 * Uses embedPage with top padding to guarantee zero header clipping
 */
async function extractFlipkartInvoices(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPageCount();
  const pageIndices = options.selectedPages || Array.from({ length: totalPages }, (_, i) => i);

  const invCaptureH = FLIPKART_INVOICE_BOX.height; // 515 pt
  const topPadding = 24; // Generous breathing room on top of invoice

  for (const pageIdx of pageIndices) {
    if (pageIdx >= totalPages) continue;
    const srcPage = srcDoc.getPage(pageIdx);
    const { width: pageW, height: pageH } = srcPage.getSize();
    const w = pageW || FLIPKART_INVOICE_BOX.width;
    const captureH = Math.min(pageH || 841.89, invCaptureH);

    const embeddedInv = await outDoc.embedPage(srcPage, {
      left: 0,
      bottom: 0,
      right: w,
      top: captureH,
    });

    const invPage = outDoc.addPage([w, captureH + topPadding]);
    invPage.drawPage(embeddedInv, {
      x: 0,
      y: 0,
      width: w,
      height: captureH,
    });
  }

  return await outDoc.save();
}

/**
 * Crops a Flipkart shipping label from an uploaded image (PNG, JPG, WebP)
 * Automatically crops the top-right shipping label portion and produces both a PDF and image Blob
 */
async function cropFlipkartLabelImage(imageFileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = async function () {
        try {
          const imgWidth = img.naturalWidth || img.width;
          const imgHeight = img.naturalHeight || img.height;
          const aspectRatio = imgHeight / imgWidth;

          let cropX, cropY, cropW, cropH;

          // If the image is a full A4 invoice page (aspect ratio > 1.3)
          if (aspectRatio > 1.3) {
            // Label is on standard Flipkart invoice sheet (x: 165 to 430, y: 460 to 820)
            cropX = imgWidth * (165 / 595.28);
            cropY = imgHeight * (21.89 / 841.89);
            cropW = imgWidth * (265 / 595.28);
            cropH = imgHeight * (360 / 841.89);
          } else {
            // Already cropped or label-only aspect ratio
            cropX = 0;
            cropY = 0;
            cropW = imgWidth;
            cropH = imgHeight;
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(cropW);
          canvas.height = Math.round(cropH);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.drawImage(
            img,
            cropX, cropY, cropW, cropH,
            0, 0, canvas.width, canvas.height
          );

          // Export as PNG blob
          const pngDataUrl = canvas.toDataURL('image/png', 1.0);
          const pngBlob = await (await fetch(pngDataUrl)).blob();

          // Generate a clean 1-page PDF containing this cropped label
          const { PDFDocument } = PDFLib;
          const pdfDoc = await PDFDocument.create();
          const pngImage = await pdfDoc.embedPng(pngDataUrl);
          const labelPage = pdfDoc.addPage([FLIPKART_LABEL_BOX.width, FLIPKART_LABEL_BOX.height]);

          labelPage.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: FLIPKART_LABEL_BOX.width,
            height: FLIPKART_LABEL_BOX.height,
          });

          const pdfBytes = await pdfDoc.save();

          resolve({
            pdfBytes,
            pngBlob,
            pngDataUrl,
            canvas,
            width: canvas.width,
            height: canvas.height,
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(imageFileOrBlob);
  });
}

/**
 * ============================================================================
 * Amazon Shipping Label & Invoice Engine
 * Pure Vector Form XObject Embedding & MediaBox Formatting (TSC, Zebra, Xprinter)
 * ============================================================================
 */

// Amazon Easy Ship standard A4 layout presets (595.28 x 841.89 pt)
const AMAZON_LABEL_BOX_2UP_TOP = {
  x: 10,
  y: 426,
  width: 276,
  height: 405,
};

const AMAZON_LABEL_BOX_2UP_BOTTOM = {
  x: 10,
  y: 12,
  width: 276,
  height: 405,
};

const AMAZON_INVOICE_BOX_2UP_TOP = {
  x: 288,
  y: 412,
  width: 304,
  height: 430, // reaches 842 pt (captures entire top header of sheet)
};

const AMAZON_INVOICE_BOX_2UP_BOTTOM = {
  x: 288,
  y: 0,
  width: 304,
  height: 434, // reaches 434 pt (captures entire top header above mid divider)
};

const AMAZON_THERMAL_PAGE = {
  width: 288,  // 4 inches = 288 pt
  height: 432, // 6 inches = 432 pt
};

/**
 * Processes Amazon Shipping Labels
 * Keeps odd-numbered pages (Page 1, 3, 5, 7...) and removes even-numbered invoice pages (Page 2, 4, 6...)
 * Preserves original 100% vector PDF pages without altering formatting or adding stamps.
 */
async function cropAmazonShippingLabels(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPageCount();

  if (totalPages <= 1) {
    // Single page PDF: keep Page 1 (index 0)
    const [copiedPage] = await outDoc.copyPages(srcDoc, [0]);
    outDoc.addPage(copiedPage);
  } else {
    // Multi-page PDF: Keep all ODD-numbered pages (Page 1, 3, 5, 7... -> indices 0, 2, 4, 6...)
    // Remove all EVEN-numbered pages (Page 2, 4, 6, 8... -> indices 1, 3, 5, 7...)
    const oddIndices = [];
    for (let i = 0; i < totalPages; i += 2) {
      oddIndices.push(i);
    }
    const copiedPages = await outDoc.copyPages(srcDoc, oddIndices);
    copiedPages.forEach((cp) => outDoc.addPage(cp));
  }

  return await outDoc.save();
}

/**
 * Extracts Tax Invoices from Amazon order documents
 * Keeps even-numbered pages (Page 2, 4, 6, 8...) and removes odd-numbered label pages
 */
async function extractAmazonInvoices(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPageCount();

  if (totalPages > 1) {
    // Keep all EVEN-numbered pages (Page 2, 4, 6, 8... -> indices 1, 3, 5, 7...)
    const evenIndices = [];
    for (let i = 1; i < totalPages; i += 2) {
      evenIndices.push(i);
    }
    if (evenIndices.length > 0) {
      const copiedPages = await outDoc.copyPages(srcDoc, evenIndices);
      copiedPages.forEach((cp) => outDoc.addPage(cp));
    }
  }

  return await outDoc.save();
}

/**
 * Crops an Amazon shipping label from an uploaded image (PNG, JPG, WebP)
 */
async function cropAmazonLabelImage(imageFileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = async function () {
        try {
          const imgWidth = img.naturalWidth || img.width;
          const imgHeight = img.naturalHeight || img.height;
          const aspectRatio = imgHeight / imgWidth;

          let cropX, cropY, cropW, cropH;

          // If full A4 Amazon order sheet (aspect ratio > 1.25)
          if (aspectRatio > 1.25) {
            // Label is in top-left or bottom-left: default to top-left shipping label
            cropX = imgWidth * (10 / 595.28);
            cropY = imgHeight * (14 / 841.89);
            cropW = imgWidth * (280 / 595.28);
            cropH = imgHeight * (410 / 841.89);
          } else {
            cropX = 0;
            cropY = 0;
            cropW = imgWidth;
            cropH = imgHeight;
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.round(cropW);
          canvas.height = Math.round(cropH);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.drawImage(
            img,
            cropX, cropY, cropW, cropH,
            0, 0, canvas.width, canvas.height
          );

          const pngDataUrl = canvas.toDataURL('image/png', 1.0);
          const pngBlob = await (await fetch(pngDataUrl)).blob();

          const { PDFDocument } = PDFLib;
          const pdfDoc = await PDFDocument.create();
          const pngImage = await pdfDoc.embedPng(pngDataUrl);
          const labelPage = pdfDoc.addPage([AMAZON_THERMAL_PAGE.width, AMAZON_THERMAL_PAGE.height]);

          labelPage.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: AMAZON_THERMAL_PAGE.width,
            height: AMAZON_THERMAL_PAGE.height,
          });

          const pdfBytes = await pdfDoc.save();

          resolve({
            pdfBytes,
            pngBlob,
            pngDataUrl,
            canvas,
            width: canvas.width,
            height: canvas.height,
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(imageFileOrBlob);
  });
}
