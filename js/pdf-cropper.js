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
  const targetBox = options.labelBox || FLIPKART_LABEL_BOX;

  // Copy pages directly to preserve all vector barcodes, text, and QR codes
  const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);

  for (const page of copiedPages) {
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
 * Crops Amazon Shipping Labels from single-page or multi-page PDFs
 * Formats each order into an individual 4x6" thermal page with pure vector barcode clarity
 * Supports automatic SKU & Quantity stamping into the label's empty slot
 */
async function cropAmazonShippingLabels(pdfBytes, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const orders = options.orders || [];
  const stampSku = options.stampSku !== false;
  let boldFont = null;

  if (stampSku) {
    try {
      boldFont = await outDoc.embedFont(StandardFonts.HelveticaBold);
    } catch (fontErr) {
      console.warn('Could not embed bold font for SKU stamp:', fontErr);
    }
  }

  // If parsed orders metadata is provided, process each order individually
  if (orders.length > 0) {
    for (const order of orders) {
      const srcPageIndex = typeof order.sourcePageIndex === 'number' ? order.sourcePageIndex : 0;
      if (srcPageIndex >= srcDoc.getPageCount()) continue;

      const srcPage = srcDoc.getPage(srcPageIndex);
      const { width: srcW, height: srcH } = srcPage.getSize();

      const page = outDoc.addPage([AMAZON_THERMAL_PAGE.width, AMAZON_THERMAL_PAGE.height]);

      if (order.labelBox) {
        // Bounding box cropping (e.g. 2-up split sheet)
        const box = order.labelBox;
        const embeddedPage = await outDoc.embedPage(srcPage, {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        });

        const margin = 4;
        const availW = AMAZON_THERMAL_PAGE.width - margin * 2;
        const availH = AMAZON_THERMAL_PAGE.height - margin * 2;
        const scale = Math.min(availW / box.width, availH / box.height);

        const drawW = box.width * scale;
        const drawH = box.height * scale;
        const drawX = (AMAZON_THERMAL_PAGE.width - drawW) / 2;
        const drawY = (AMAZON_THERMAL_PAGE.height - drawH) / 2;

        page.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });

        // Stamp SKU & Quantity into the label's empty gap if available
        if (stampSku && boldFont && order.sku && order.sku !== 'Amazon Item' && order.sku !== 'General Item') {
          const qtyPart = order.qty ? ` | Qty - ${order.qty}` : '';
          const stampText = `${order.sku}${qtyPart}`;
          const maxLen = 42;
          const displayText = stampText.length > maxLen ? stampText.substring(0, maxLen - 1) + '…' : stampText;

          page.drawText(displayText, {
            x: Math.round(drawX + 16),
            y: Math.round(drawY + 68),
            size: 9.5,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
        }
      } else {
        // Full page label (e.g. Odd page from alternating 2-page-per-order PDF or 4x6 label)
        const embeddedPage = await outDoc.embedPage(srcPage);
        const margin = 6;
        const availW = AMAZON_THERMAL_PAGE.width - margin * 2;
        const availH = AMAZON_THERMAL_PAGE.height - margin * 2;
        const scale = Math.min(availW / srcW, availH / srcH);

        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const drawX = (AMAZON_THERMAL_PAGE.width - drawW) / 2;
        const drawY = (AMAZON_THERMAL_PAGE.height - drawH) / 2;

        page.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });

        // Stamp SKU & Quantity inside the blank whitespace right above the bottom routing box (matches crp-amz.png)
        if (stampSku && boldFont && order.sku && order.sku !== 'Amazon Item' && order.sku !== 'General Item' && order.sku !== 'Amazon Order') {
          const qty = order.qty || 1;
          const stampText = `${order.sku} | Qty - ${qty}`;
          const maxLen = 42;
          const displayText = stampText.length > maxLen ? stampText.substring(0, maxLen - 1) + '…' : stampText;

          // Exact placement: in the white gap above STXA routing boxes
          const stampX = Math.round(drawX + drawW * 0.14);
          const stampY = Math.round(drawY + drawH * 0.165);

          page.drawText(displayText, {
            x: stampX,
            y: stampY,
            size: 10.5,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
        }
      }
    }
  } else {
    // Fallback: If metadata orders not provided, process each page in the PDF
    const totalPages = srcDoc.getPageCount();
    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
      const srcPage = srcDoc.getPage(pIdx);
      const { width: srcW, height: srcH } = srcPage.getSize();
      const page = outDoc.addPage([AMAZON_THERMAL_PAGE.width, AMAZON_THERMAL_PAGE.height]);

      if (srcW > 500) {
        // Standard A4 sheet: crop top-left shipping label box
        const box = AMAZON_LABEL_BOX_2UP_TOP;
        const embeddedPage = await outDoc.embedPage(srcPage, {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        });

        const margin = 4;
        const availW = AMAZON_THERMAL_PAGE.width - margin * 2;
        const availH = AMAZON_THERMAL_PAGE.height - margin * 2;
        const scale = Math.min(availW / box.width, availH / box.height);

        const drawW = box.width * scale;
        const drawH = box.height * scale;
        const drawX = (AMAZON_THERMAL_PAGE.width - drawW) / 2;
        const drawY = (AMAZON_THERMAL_PAGE.height - drawH) / 2;

        page.drawPage(embeddedPage, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });
      } else {
        // 4x6 Direct Thermal page
        const embeddedPage = await outDoc.embedPage(srcPage);
        const margin = 6;
        const availW = AMAZON_THERMAL_PAGE.width - margin * 2;
        const availH = AMAZON_THERMAL_PAGE.height - margin * 2;
        const scale = Math.min(availW / srcW, availH / srcH);

        const drawW = srcW * scale;
        const drawH = srcH * scale;

        page.drawPage(embeddedPage, {
          x: (AMAZON_THERMAL_PAGE.width - drawW) / 2,
          y: (AMAZON_THERMAL_PAGE.height - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }
    }
  }

  return await outDoc.save();
}

/**
 * Extracts Tax Invoices from Amazon order sheets or multi-page documents (Even pages 2, 4, 6...)
 */
async function extractAmazonInvoices(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const orders = options.orders || [];

  if (orders.length > 0) {
    for (const order of orders) {
      if (typeof order.invoicePageIndex === 'number') {
        // Multi-page alternating invoice (Even page e.g. Page 2, 4, 6)
        if (order.invoicePageIndex < srcDoc.getPageCount()) {
          const [copiedPage] = await outDoc.copyPages(srcDoc, [order.invoicePageIndex]);
          outDoc.addPage(copiedPage);
        }
      } else if (order.invoiceBox) {
        // Split sheet invoice box
        const srcPageIndex = typeof order.sourcePageIndex === 'number' ? order.sourcePageIndex : 0;
        if (srcPageIndex >= srcDoc.getPageCount()) continue;

        const srcPage = srcDoc.getPage(srcPageIndex);
        const invBox = order.invoiceBox || AMAZON_INVOICE_BOX_2UP_TOP;

        const embeddedInv = await outDoc.embedPage(srcPage, {
          left: invBox.x,
          bottom: invBox.y,
          right: invBox.x + invBox.width,
          top: invBox.y + invBox.height,
        });

        const topPadding = 24;
        const invPage = outDoc.addPage([invBox.width, invBox.height + topPadding]);
        invPage.drawPage(embeddedInv, {
          x: 0,
          y: 0,
          width: invBox.width,
          height: invBox.height,
        });
      }
    }
  } else {
    // Fallback: Copy all even pages if multi-page document
    const totalPages = srcDoc.getPageCount();
    if (totalPages > 1) {
      const evenPageIndices = [];
      for (let p = 1; p < totalPages; p += 2) {
        evenPageIndices.push(p);
      }
      if (evenPageIndices.length > 0) {
        const copiedPages = await outDoc.copyPages(srcDoc, evenPageIndices);
        copiedPages.forEach((cp) => outDoc.addPage(cp));
      }
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
