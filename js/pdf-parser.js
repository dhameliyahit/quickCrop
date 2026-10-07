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

  if (numPages === 0) return orders;

  // 1. Scan and inspect all pages in the PDF
  const pagesInfo = [];
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
    const fullText = items.map((it) => it.str).join(' ');

    const hasLabelText = /AWB|SHIP\s*TO|DELIVERY\s*STATION|ATSPL|COD|PREPAID|SURFACE|STANDARD|Amazon\s*Easy\s*Ship|Return\s*Address|Courier/i.test(fullText);
    const hasInvoiceText = /Tax\s*Invoice|Invoice\s*Number|GSTIN|HSN|Sold\s*By|Bill\s*To|Billing\s*Address|Invoice\s*Date|Unit\s*Price|Authorized\s*Signatory|Total\s*Amount/i.test(fullText);

    // Also check left vs right distribution (for 2-on-1 sheets)
    const leftItems = items.filter((it) => it.transform && it.transform[4] < midX + 15);
    const rightItems = items.filter((it) => it.transform && it.transform[4] >= midX - 15);
    const leftText = leftItems.map((it) => it.str).join(' ');
    const rightText = rightItems.map((it) => it.str).join(' ');

    const isLeftLabel = /AWB|Order|Ship|STVT|ATSPL|SUR|COD|PREPAID|Customer|Declaration|amazon|BOX/i.test(leftText);
    const isRightInvoice = /Invoice|GSTIN|Sold\s*By|Order\s*Number|HSN|Unit\s*Price|Total/i.test(rightText);

    pagesInfo.push({
      pageNum,
      pageIndex: pageNum - 1,
      pageW,
      pageH,
      midX,
      midY,
      items,
      fullText,
      leftText,
      rightText,
      hasLabelText,
      hasInvoiceText,
      isLeftLabel,
      isRightInvoice,
      isSplitSheet: isLeftLabel && isRightInvoice && pageW > 500,
    });
  }

  // 2. Multi-page Amazon / Thermal PDF Handling
  // Rule: Odd pages (1, 3, 5...) are Shipping Labels (to print), Even pages (2, 4, 6...) are Invoices (to separate & extract SKU/Qty)
  let isAlternatingFormat = false;
  const hasSplitSheets = pagesInfo.some((p) => p.isSplitSheet);

  if (numPages >= 2 && !hasSplitSheets) {
    isAlternatingFormat = true;
  } else if (numPages >= 2) {
    // Check if odd pages look like shipping labels or even pages look like invoices
    let oddPagesLookLikeLabels = false;
    let evenPagesLookLikeInvoices = false;
    for (let i = 0; i < numPages; i += 2) {
      if (pagesInfo[i] && (pagesInfo[i].hasLabelText || pagesInfo[i].isLeftLabel)) {
        oddPagesLookLikeLabels = true;
      }
      if (pagesInfo[i + 1] && (pagesInfo[i + 1].hasInvoiceText || pagesInfo[i + 1].isRightInvoice)) {
        evenPagesLookLikeInvoices = true;
      }
    }
    if (oddPagesLookLikeLabels || evenPagesLookLikeInvoices) {
      isAlternatingFormat = true;
    }
  }

  // ==========================================================================
  // CASE A: Alternating Multi-Page Mode (Odd Pages 1, 3, 5... = Label, Even Pages 2, 4, 6... = Invoice)
  // For a 6-page PDF: 3 orders (Labels: 1, 3, 5 | Invoices: 2, 4, 6)
  // ==========================================================================
  if (isAlternatingFormat) {
    const totalOrderCount = Math.ceil(numPages / 2);

    for (let k = 0; k < totalOrderCount; k++) {
      const labelPageIndex = k * 2;
      const invoicePageIndex = (k * 2 + 1 < numPages) ? (k * 2 + 1) : null;
      const labelPageInfo = pagesInfo[labelPageIndex] || { fullText: '', items: [] };
      const invoicePageInfo = (invoicePageIndex !== null ? pagesInfo[invoicePageIndex] : null) || { fullText: '', items: [] };

      const labelText = labelPageInfo.fullText || '';
      const invoiceText = invoicePageInfo.fullText || '';
      const combinedText = `${labelText} ${invoiceText}`;

      // Extract Order ID (e.g. 407-5636330-3869926)
      const orderIdMatch =
        combinedText.match(/([0-9]{3}-[0-9]{7}-[0-9]{7})/) ||
        combinedText.match(/Order\s*Id:?\s*([A-Z0-9\-]+)/i) ||
        combinedText.match(/OD[0-9]{16,20}/i);
      const orderId = orderIdMatch ? orderIdMatch[1] || orderIdMatch[0] : `Order #${k + 1}`;

      // AWB Number
      const awbMatch =
        labelText.match(/AWB\s*[:]?\s*([A-Z0-9]+)/i) ||
        labelText.match(/AWB:?\s*([0-9]{8,18})/i) ||
        invoiceText.match(/AWB\s*[:]?\s*([A-Z0-9]+)/i);
      const awbNo = awbMatch ? awbMatch[1] : 'AWB-N/A';

      // Courier & Station
      let courier = 'ATSPL';
      if (combinedText.includes('ATSPL')) courier = 'ATSPL';
      else if (combinedText.includes('Delhivery')) courier = 'Delhivery';
      else if (combinedText.includes('Blue Dart')) courier = 'Blue Dart';
      else if (combinedText.includes('Shadowfax')) courier = 'Shadowfax';
      else if (combinedText.includes('Amazon Easy Ship')) courier = 'Amazon Easy Ship';

      const stationMatch = labelText.match(/DELIVERY\s*STATION\s*[:]?\s*([A-Z0-9]+)/i) || labelText.match(/STATION\s*[:]?\s*([A-Z0-9]{3,8})/i);
      const station = stationMatch ? stationMatch[1] : '';

      // Payment Mode
      const paymentMode = combinedText.includes('COD') ? 'COD' : 'PREPAID';

      // SKU & Quantity Extraction from Invoice Page
      let sku = '';
      let qty = 1;

      // 1. Amazon standard ASIN parenthesized seller SKU: e.g. "B0H8JLMXKR ( HZ-ILOV-9516 )"
      const asinMatch = invoiceText.match(/B0[A-Z0-9]{8}\s*\(\s*([^()]+?)\s*\)/i);
      if (asinMatch && asinMatch[1]) {
        const candidate = asinMatch[1].trim();
        if (!/triplicate|duplicate|original|supplier|only|resale|tax|gst/i.test(candidate)) {
          sku = candidate;
        }
      }

      // 2. Parenthesized SKU right before HSN or price: e.g. "( HZ-ILOV-9516 ) HSN"
      if (!sku) {
        const hsnParenMatch = invoiceText.match(/\(\s*([A-Za-z0-9_\-\.\/ ]{3,40})\s*\)\s*(?:HSN|₹|Total)/i);
        if (hsnParenMatch && hsnParenMatch[1]) {
          const candidate = hsnParenMatch[1].trim();
          if (!/triplicate|duplicate|original|supplier|only|resale|tax|gst|demand|payment/i.test(candidate)) {
            sku = candidate;
          }
        }
      }

      // 3. Any parenthesized code with uppercase/digits/hyphens
      if (!sku) {
        const allParens = [...invoiceText.matchAll(/\(\s*([^()]{2,60}?)\s*\)/g)];
        for (const m of allParens) {
          const candidate = m[1].trim();
          if (!/triplicate|duplicate|original|supplier|only|resale|tax|gst|demand|payment|princess|candy|blue|red|green|black|white/i.test(candidate) && /[0-9A-Za-z]/.test(candidate)) {
            sku = candidate;
            break;
          }
        }
      }

      // 4. Fallback: SKU ID in invoice or label
      if (!sku) {
        const skuInlineMatch = invoiceText.match(/SKU\s*(?:ID|Code|No)?\s*[:|-]\s*([A-Za-z0-9_\-\.\/ ]{2,45})/i) ||
          labelText.match(/SKU\s*(?:ID|Code|No)?\s*[:|-]\s*([A-Za-z0-9_\-\.\/ ]{2,45})/i);
        if (skuInlineMatch && skuInlineMatch[1]) {
          sku = skuInlineMatch[1].trim();
        }
      }

      // 5. Fallback Description snippet
      if (!sku) {
        const descMatch = invoiceText.match(/Description[\s\S]*?(?:HSN|₹|Total|TOTAL|Unit Price|Gross Amount)/i);
        if (descMatch) {
          const cleaned = descMatch[0]
            .replace(/Description/i, '')
            .replace(/(?:HSN|₹|Total|TOTAL|Unit Price|Gross Amount)[\s\S]*/i, '')
            .replace(/1\s+/g, '')
            .trim();
          if (cleaned.length > 2) {
            sku = cleaned.split('|')[0].trim().substring(0, 45);
          }
        }
      }

      if (!sku) {
        sku = '';
      }

      // Quantity
      const qtyMatch = invoiceText.match(/Qty\s*[:]?\s*(\d+)/i) || invoiceText.match(/₹[\d,.]+\s+(\d+)\s+₹/i);
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
        sourcePageIndex: labelPageIndex,      // Odd page (0, 2, 4...)
        invoicePageIndex: invoicePageIndex,  // Even page (1, 3, 5...)
        isFullPage: true,
        mode: 'alternating-pages',
        labelBox: null,
        invoiceBox: null,
        selected: true,
      });
    }

    return orders;
  }

  // ==========================================================================
  // CASE B: 2-on-1 Split A4 Sheets (Left half = Label, Right half = Invoice)
  // Or multi-order sheets with 1 or 2 orders per page
  // ==========================================================================
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const pageInfo = pagesInfo[pageNum - 1];
    const pageW = pageInfo.pageW;
    const pageH = pageInfo.pageH;
    const midX = pageInfo.midX;
    const midY = pageInfo.midY;
    const items = pageInfo.items;

    // Check if label text is in top half and/or bottom half
    const leftItems = items.filter((it) => it.transform && it.transform[4] < midX + 15);
    const topItems = leftItems.filter((it) => it.transform[5] >= midY - 20);
    const bottomItems = leftItems.filter((it) => it.transform[5] < midY + 20);

    const topText = topItems.map((it) => it.str).join(' ');
    const bottomText = bottomItems.map((it) => it.str).join(' ');

    const isOrderPresent = (t) => /AWB|Order|Ship|STVT|ATSPL|SUR|COD|PREPAID|Customer|Declaration|amazon|BOX/i.test(t);

    const hasTopLabel = isOrderPresent(topText);
    const hasBottomLabel = isOrderPresent(bottomText);

    // Standard 2-up split bounds
    const topLabelBox = {
      x: 10,
      y: Math.round(midY) + 5,
      width: Math.round(midX - 22),
      height: Math.round(pageH - midY - 16),
    };
    const topInvoiceBox = {
      x: Math.round(midX) - 8,
      y: Math.max(0, Math.round(midY) - 8),
      width: Math.round(midX) + 8,
      height: Math.round(pageH - midY) + 10,
    };

    const bottomLabelBox = {
      x: 10,
      y: 12,
      width: Math.round(midX - 22),
      height: Math.round(midY - 18),
    };
    const bottomInvoiceBox = {
      x: Math.round(midX) - 8,
      y: 0,
      width: Math.round(midX) + 8,
      height: Math.round(midY) + 14,
    };

    let slots = [];
    if (hasTopLabel && hasBottomLabel) {
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
      // Fallback: If page is standard A4 size
      if (pageW > 500) {
        slots = [
          { index: 0, name: 'top', minY: midY, maxY: pageH, labelBox: topLabelBox, invoiceBox: topInvoiceBox },
          { index: 1, name: 'bottom', minY: 0, maxY: midY, labelBox: bottomLabelBox, invoiceBox: bottomInvoiceBox },
        ];
      } else {
        // Direct thermal page (e.g. 288x432 pt 4x6)
        slots = [
          { index: 0, name: 'full', minY: 0, maxY: pageH, labelBox: null, invoiceBox: null, isFullPage: true },
        ];
      }
    }

    for (const slot of slots) {
      const slotLeftItems = items.filter(
        (it) => it.transform && it.transform[4] < midX + 15 && it.transform[5] >= slot.minY - 15 && it.transform[5] <= slot.maxY + 15
      );
      const slotLeftText = slotLeftItems.map((it) => it.str).join(' ');

      const slotRightItems = items.filter(
        (it) => it.transform && it.transform[4] >= midX - 15 && it.transform[5] >= slot.minY - 15 && it.transform[5] <= slot.maxY + 15
      );
      const slotRightText = slotRightItems.map((it) => it.str).join(' ');

      if (slot.labelBox && !slotLeftText.includes('Order') && !slotLeftText.includes('AWB') && !slotRightText.includes('Order') && !slotLeftText.includes('ATSPL')) {
        continue;
      }

      const combinedSlotText = `${slotLeftText} ${slotRightText}`;

      const orderIdMatch =
        combinedSlotText.match(/([0-9]{3}-[0-9]{7}-[0-9]{7})/) ||
        combinedSlotText.match(/Order\s*Id:?\s*([0-9A-Z\-]+)/i);
      const orderId = orderIdMatch ? orderIdMatch[1] || orderIdMatch[0] : `Order #${orders.length + 1}`;

      const awbMatch = slotLeftText.match(/AWB\s*([A-Z0-9]+)/i) || slotLeftText.match(/AWB:?\s*([0-9]{8,16})/i);
      const awbNo = awbMatch ? awbMatch[1] : 'AWB-N/A';

      let courier = 'ATSPL';
      if (combinedSlotText.includes('ATSPL')) courier = 'ATSPL';
      else if (combinedSlotText.includes('Delhivery')) courier = 'Delhivery';
      else if (combinedSlotText.includes('Blue Dart')) courier = 'Blue Dart';

      const stationMatch = slotLeftText.match(/DELIVERY\s*STATION\s*([A-Z0-9]+)/i);
      const station = stationMatch ? stationMatch[1] : '';

      const paymentMode = combinedSlotText.includes('COD') ? 'COD' : 'PREPAID';

      let sku = '';
      let qty = 1;

      const parenMatch = slotRightText.match(/\(\s*([^()]{2,60}?)\s*\)/);
      if (parenMatch && parenMatch[1]) {
        const candidate = parenMatch[1].trim();
        if (!/triplicate|duplicate|original|supplier|only|resale/i.test(candidate)) {
          sku = candidate;
        }
      }

      if (!sku) {
        const descMatch = slotRightText.match(/Description[\s\S]*?(?:HSN|₹|Total|TOTAL|Unit Price)/i);
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

      if (!sku) {
        sku = 'Amazon Item';
      }

      const qtyMatch = slotRightText.match(/Qty\s*[:]?\s*(\d+)/i) || slotRightText.match(/₹[\d,.]+\s+(\d+)\s+₹/i);
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
        isFullPage: !!slot.isFullPage,
        mode: slot.labelBox ? '2up-sheet' : 'fullpage',
        selected: true,
      });
    }
  }

  return orders;
}

