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

/**
 * ============================================================================
 * Amazon Shipping Label & Invoice Metadata Parser
 * Dynamically detects 1-up, 2-up, or 3-up orders per A4 sheet
 * Extracts Order ID, AWB, Delivery Station, Courier (ATSPL), SKU, Qty, and Payment
 * ============================================================================
 */
async function parseAmazonPdfMetadata(pdfDoc, onProgress) {
  const orders = [];
  const numPages = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (typeof onProgress === 'function') {
      onProgress(pageNum, numPages);
    }

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const pageW = viewport.width || 595.28;
    const pageH = viewport.height || 841.89;
    const midX = pageW * 0.5;
    const midY = pageH * 0.5;

    const textContent = await page.getTextContent();
    const items = textContent.items;

    // Robust detection: inspect all text items on left half (shipping label column)
    const leftItems = items.filter((it) => it.transform && it.transform[4] < midX + 10);
    const topItems = leftItems.filter((it) => it.transform[5] >= midY - 20);
    const bottomItems = leftItems.filter((it) => it.transform[5] < midY + 20);

    const topText = topItems.map((it) => it.str).join(' ');
    const bottomText = bottomItems.map((it) => it.str).join(' ');

    const isOrderPresent = (t) => /AWB|Order|Ship|STVT|ATSPL|SUR|COD|PREPAID|Customer|Declaration|amazon|BOX/i.test(t);

    const hasTopLabel = isOrderPresent(topText);
    const hasBottomLabel = isOrderPresent(bottomText);

    // Precise crop boundaries excluding dashed cut lines
    const topLabelBox = {
      x: 10,
      y: Math.round(midY) + 5, // y = 426 pt (above horizontal dashed line at 421 pt)
      width: Math.round(midX - 22), // width = 276 pt (left of vertical dashed line at 297 pt)
      height: Math.round(pageH - midY - 16), // height = 405 pt
    };
    const topInvoiceBox = {
      x: Math.round(midX) + 2,
      y: Math.round(midY) + 5,
      width: Math.round(midX - 10),
      height: Math.round(pageH - midY - 16),
    };

    const bottomLabelBox = {
      x: 10,
      y: 12, // y = 12 pt (covers bottom ATSPL line)
      width: Math.round(midX - 22), // width = 276 pt
      height: Math.round(midY - 18), // height = 403 pt (safely below dashed line at 421 pt)
    };
    const bottomInvoiceBox = {
      x: Math.round(midX) + 2,
      y: 12,
      width: Math.round(midX - 10),
      height: Math.round(midY - 18),
    };

    let slots = [];
    if (hasTopLabel && hasBottomLabel) {
      // 2 orders on this page: Top order and Bottom order
      slots = [
        { index: 0, name: 'top', minY: midY, maxY: pageH, labelBox: topLabelBox, invoiceBox: topInvoiceBox },
        { index: 1, name: 'bottom', minY: 0, maxY: midY, labelBox: bottomLabelBox, invoiceBox: bottomInvoiceBox },
      ];
    } else if (hasBottomLabel && !hasTopLabel) {
      slots = [
        { index: 0, name: 'bottom', minY: 0, maxY: midY, labelBox: bottomLabelBox, invoiceBox: bottomInvoiceBox },
      ];
    } else if (hasTopLabel && !hasBottomLabel) {
      slots = [
        { index: 0, name: 'top', minY: midY, maxY: pageH, labelBox: topLabelBox, invoiceBox: topInvoiceBox },
      ];
    } else {
      // Fallback: Default to standard 2-up sheet so both labels are always captured
      slots = [
        { index: 0, name: 'top', minY: midY, maxY: pageH, labelBox: topLabelBox, invoiceBox: topInvoiceBox },
        { index: 1, name: 'bottom', minY: 0, maxY: midY, labelBox: bottomLabelBox, invoiceBox: bottomInvoiceBox },
      ];
    }

    // Process each slot on this page
    for (const slot of slots) {
      // Extract text on left half for label metadata
      const leftItems = items.filter(
        (it) => it.transform && it.transform[4] < midX && it.transform[5] >= slot.minY - 15 && it.transform[5] <= slot.maxY + 15
      );
      const leftText = leftItems.map((it) => it.str).join(' ');

      // Extract text on right half for invoice metadata
      const rightItems = items.filter(
        (it) => it.transform && it.transform[4] >= midX - 10 && it.transform[5] >= slot.minY - 15 && it.transform[5] <= slot.maxY + 15
      );
      const rightText = rightItems.map((it) => it.str).join(' ');

      // If neither side has order indicators, skip empty slot
      if (!leftText.includes('Order') && !leftText.includes('AWB') && !rightText.includes('Order')) {
        continue;
      }

      // Order ID (e.g. 407-5636330-3869926)
      const orderIdMatch =
        leftText.match(/Order\s*Id:?\s*([0-9]{3}-[0-9]{7}-[0-9]{7})/i) ||
        rightText.match(/Order\s*Number:?\s*([0-9]{3}-[0-9]{7}-[0-9]{7})/i) ||
        leftText.match(/([0-9]{3}-[0-9]{7}-[0-9]{7})/);
      const orderId = orderIdMatch ? orderIdMatch[1] || orderIdMatch[0] : `Order #${orders.length + 1}`;

      // AWB Number
      const awbMatch = leftText.match(/AWB\s*([A-Z0-9]+)/i) || leftText.match(/AWB:?\s*([0-9]{8,16})/i);
      const awbNo = awbMatch ? awbMatch[1] : 'AWB-N/A';

      // Courier & Station
      let courier = 'ATSPL';
      if (leftText.includes('ATSPL')) courier = 'ATSPL';
      else if (leftText.includes('Delhivery')) courier = 'Delhivery';
      else if (leftText.includes('Blue Dart')) courier = 'Blue Dart';

      const stationMatch = leftText.match(/DELIVERY\s*STATION\s*([A-Z0-9]+)/i);
      const station = stationMatch ? stationMatch[1] : '';

      // Payment Mode
      const paymentMode = leftText.includes('COD') || rightText.includes('COD') ? 'COD' : 'PREPAID';

      // SKU & Quantity Extraction from Invoice Description Table
      let sku = '';
      let qty = 1;

      // 1. Try to extract parenthesized SKU: e.g. "B0H3FD6QS3 ( Fruit basket )"
      const parenMatch = rightText.match(/\(\s*([^()]{2,60}?)\s*\)/);
      if (parenMatch && parenMatch[1]) {
        const candidate = parenMatch[1].trim();
        // Ignore non-SKU parenthesized strings like "(Triplicate for Supplier)" or "( Fruit basket )"
        if (!/triplicate|duplicate|original|supplier|only|resale/i.test(candidate)) {
          sku = candidate;
        }
      }

      // 2. If no parenthesized SKU, look in Description column
      if (!sku) {
        const descMatch = rightText.match(/Description[\s\S]*?(?:HSN|₹|Total|TOTAL|Unit Price)/i);
        if (descMatch) {
          const cleaned = descMatch[0]
            .replace(/Description/i, '')
            .replace(/(?:HSN|₹|Total|TOTAL|Unit Price)[\s\S]*/i, '')
            .replace(/1\s+/g, '')
            .trim();
          if (cleaned.length > 2) {
            sku = cleaned.split('|')[0].trim().substring(0, 45);
          }
        }
      }

      // Fallback SKU
      if (!sku) {
        sku = 'General Item';
      }

      // Quantity
      const qtyMatch = rightText.match(/Qty\s*[:]?\s*(\d+)/i) || rightText.match(/₹[\d,.]+\s+(\d+)\s+₹/i);
      if (qtyMatch && qtyMatch[1]) {
        qty = parseInt(qtyMatch[1], 10) || 1;
      }

      orders.push({
        orderIndex: orders.length,
        orderId,
        awbNo,
        courier,
        station,
        sku,
        qty,
        paymentMode,
        sourcePageIndex: pageNum - 1,
        slotIndex: slot.index,
        labelBox: slot.labelBox,
        invoiceBox: slot.invoiceBox,
        selected: true,
      });
    }
  }

  return orders;
}
