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

const FLIPKART_INVOICE_BOX = {
  x: 10,
  y: 10,
  width: 575,
  height: 440,
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
 */
async function extractFlipkartInvoices(pdfBytes, options = {}) {
  const { PDFDocument } = PDFLib;
  const safeBytes = pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes.slice ? pdfBytes.slice(0) : pdfBytes);
  const srcDoc = await PDFDocument.load(safeBytes);
  const outDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPageCount();
  const pageIndices = options.selectedPages || Array.from({ length: totalPages }, (_, i) => i);

  const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);

  for (const page of copiedPages) {
    page.setCropBox(
      FLIPKART_INVOICE_BOX.x,
      FLIPKART_INVOICE_BOX.y,
      FLIPKART_INVOICE_BOX.width,
      FLIPKART_INVOICE_BOX.height
    );
    page.setMediaBox(
      FLIPKART_INVOICE_BOX.x,
      FLIPKART_INVOICE_BOX.y,
      FLIPKART_INVOICE_BOX.width,
      FLIPKART_INVOICE_BOX.height
    );

    outDoc.addPage(page);
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
