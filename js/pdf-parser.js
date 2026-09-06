/**
 * QuickCrop - PDF Metadata Parser & Canvas Renderer
 * Powered by Mozilla pdf.js
 */

// Set up worker
if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * Loads a PDF document from ArrayBuffer (always clones buffer to prevent worker detachment)
 */
async function loadPdfDoc(arrayBuffer) {
  const clone = arrayBuffer.slice ? arrayBuffer.slice(0) : new Uint8Array(arrayBuffer).slice().buffer;
  const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(clone) });
  return await loadingTask.promise;
}

/**
 * Extracts metadata (Order ID, SKU, Courier, Payment) from each order page
 */
async function parsePdfMetadata(pdfDoc, onProgress) {
  const pagesData = [];
  const numPages = pdfDoc.numPages;
  // Default to standard right-aligned Flipkart layout (matches user red box)
  let detectedBox = { x: 165, y: 460, width: 265, height: 360 };

  for (let i = 1; i <= numPages; i++) {
    if (typeof onProgress === 'function') {
      onProgress(i, numPages);
    }
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item) => item.str);
    const fullText = textItems.join(' ');

    // Detect label position from top-half header text coordinates
    for (const item of textContent.items) {
      if (item.transform && item.transform[5] > 400) {
        const str = item.str.trim();
        const tx = item.transform[4];
        if (/^(STD|SURFACE|E-Kart|COD|PREPAID|Ordered\s*through)$/i.test(str)) {
          if (tx > 100) {
            detectedBox = { x: 165, y: 460, width: 265, height: 360 };
          } else if (tx < 80) {
            detectedBox = { x: 15, y: 460, width: 265, height: 360 };
          }
          break;
        }
      }
    }

    // Order ID
    const orderIdMatch = fullText.match(/OD\d{16,20}/i) || fullText.match(/Order\s*Id:?\s*([A-Z0-9]+)/i);
    const orderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : `Order #${i}`;

    // AWB No
    const awbMatch = fullText.match(/AWB\s*(?:No\.?)?:?\s*([A-Z0-9]+)/i) || fullText.match(/FMPC\d+/i);
    const awbNo = awbMatch ? (awbMatch[1] || awbMatch[0]) : 'AWB-N/A';

    // Courier
    let courier = 'E-Kart Logistics';
    if (fullText.includes('Delhivery')) courier = 'Delhivery';
    else if (fullText.includes('Shadowfax')) courier = 'Shadowfax';
    else if (fullText.includes('Blue Dart')) courier = 'Blue Dart';

    // SKU
    let sku = '';
    const skuSectionMatch = fullText.match(/SKU\s*ID\s*\|?\s*Description[\s\S]*?(?:TOTAL|FMPC|Not for resale|$)/i);
    if (skuSectionMatch) {
      const cleaned = skuSectionMatch[0]
        .replace(/SKU\s*ID\s*\|?\s*Description/i, '')
        .replace(/TOTAL[\s\S]*/i, '')
        .trim();
      if (cleaned.length > 2) {
        sku = cleaned.split('\n')[0].substring(0, 45).trim();
      }
    }
    if (!sku) {
      const skuInlineMatch = fullText.match(/SKU\s*(?:ID)?\s*[:|-]\s*([A-Za-z0-9_\-\.\/ ]{2,45})/i);
      if (skuInlineMatch && skuInlineMatch[1]) {
        sku = skuInlineMatch[1].trim();
      }
    }
    if (!sku) {
      sku = 'General Product';
    }

    const paymentMode = fullText.includes('COD') ? 'COD' : 'PREPAID';

    pagesData.push({
      pageIndex: i - 1,
      pageNumber: i,
      orderId,
      awbNo,
      courier,
      sku,
      paymentMode,
      selected: true,
    });
  }

  pagesData.detectedBox = detectedBox;
  return pagesData;
}
