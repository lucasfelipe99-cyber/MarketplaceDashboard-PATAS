'use strict';

const OUTPUT_HEADERS = [
  'Marketplace', 'Marketplace venda', 'ID do pedido', 'Data Completa', 'Data',
  'Status do pedido', 'Status', 'Opção de envio', 'ID do Produto', 'Nome do Produto',
  'Número de referência SKU', 'Preço acordado', 'Quantidade', 'Faturamento',
  'Desconto', 'Rebate', 'Comissão', 'Frete', 'Taxa de Envio Reversa', 'Líquido',
  'Antecipa', 'Imposto', 'Custo do produto', 'Gross margin', 'Gross margin %'
];

function text(value) {
  return value == null ? '' : String(value).trim();
}

function normalized(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function number(value, column, line) {
  if (value == null || text(value) === '' || text(value) === '-') return 0;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error(`A coluna '${column}' contém número inválido na linha ${line}.`);
  }
  let cleaned = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (cleaned.includes(',')) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  else cleaned = cleaned.replace(/,/g, '');
  const result = Number(cleaned);
  if (!Number.isFinite(result)) throw new Error(`A coluna '${column}' contém número inválido na linha ${line}: ${text(value)}.`);
  return result;
}

function indexes(headers) {
  const positions = new Map();
  headers.forEach((header, index) => {
    const key = normalized(header);
    if (!positions.has(key)) positions.set(key, []);
    positions.get(key).push(index);
  });
  const first = (name) => {
    const found = positions.get(normalized(name)) || [];
    return found.length ? found[0] : -1;
  };
  const second = (name) => {
    const found = positions.get(normalized(name)) || [];
    return found.length > 1 ? found[1] : -1;
  };
  const map = {
    orderId: first('ID do pedido'), orderStatus: first('Status do pedido'), returnStatus: first('Status da Devolução / Reembolso'),
    paidAt: first('Hora do pagamento do pedido'), createdAt: first('Data de criação do pedido'), shippingOption: first('Opção de envio'),
    productName: first('Nome do Produto'), sku: first('Número de referência SKU'), agreedPrice: first('Preço acordado'), quantity: first('Quantidade'),
    subtotal: first('Subtotal do produto'), sellerDiscount1: first('Desconto do vendedor'), sellerDiscount2: second('Desconto do vendedor'),
    campaignIncentive: first('Incentivo Shopee para ação comercial'), campaignAdjustment: first('Ajuste por participação em ação comercial'),
    sellerCoupon: first('Cupom do vendedor'), sellerCashback: first('Coin Cashback Voucher Amount Sponsored by Seller'),
    shopeeBundleDiscount: first('Desconto Shopee da Leve Mais por Menos'), sellerBundleDiscount: first('Desconto da Leve Mais por Menos do vendedor'),
    reverseShipping: first('Taxa de Envio Reversa'), grossCommission: first('Taxa de comissão bruta'), grossService: first('Taxa de serviço bruta')
  };
  const missing = Object.entries(map).filter(([, index]) => index < 0).map(([key]) => key);
  if (missing.length) throw new Error('Colunas obrigatórias ausentes na aba orders: ' + missing.join(', ') + '.');
  return map;
}

function statusFor(orderStatus, returnStatus, paidAt) {
  if (text(returnStatus)) return 'Devolução';
  const key = normalized(orderStatus);
  if (key === 'order received') return 'Devolução';
  if (key === 'cancelado') return 'Cancelado';
  if (key === 'nao pago') return 'Não pago';
  if (['concluido', 'enviado', 'a enviar', 'entregue'].includes(key) || key.startsWith('o comprador pode pedir uma devolucao')) return 'Venda';
  return 'Cancelado';
}

function dateOnly(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function transformShopee(payload, pricingDatabase) {
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!headers.length || !sourceRows.length) throw new Error("O arquivo da Shopee não contém linhas na aba 'orders'.");
  const ix = indexes(headers);
  const taxRate = Number(payload.taxRate) / 100;
  const anticipationRate = Number(payload.anticipationRate) / 100;
  const freight = Number(payload.freight);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) throw new Error('Alíquota de imposto inválida.');
  if (!Number.isFinite(anticipationRate) || anticipationRate < 0 || anticipationRate > 1) throw new Error('Antecipação inválida.');
  if (!Number.isFinite(freight)) throw new Error('Frete inválido.');

  const numericFields = ['agreedPrice', 'quantity', 'subtotal', 'sellerDiscount1', 'sellerDiscount2', 'campaignIncentive', 'campaignAdjustment', 'sellerCoupon', 'sellerCashback', 'shopeeBundleDiscount', 'sellerBundleDiscount', 'reverseShipping', 'grossCommission', 'grossService'];
  const rows = sourceRows.filter((row) => Array.isArray(row) && row.some((value) => text(value))).map((row, rowIndex) => {
    const values = { row, line: rowIndex + 2 };
    numericFields.forEach((field) => { values[field] = number(row[ix[field]], headers[ix[field]], values.line); });
    values.orderId = text(row[ix.orderId]);
    if (!values.orderId) throw new Error(`ID do pedido ausente na linha ${values.line}.`);
    return values;
  });

  const orders = new Map();
  rows.forEach((item) => {
    const group = orders.get(item.orderId) || { totalPrice: 0, cashDiscount: 0 };
    group.totalPrice += item.subtotal;
    group.cashDiscount += item.sellerDiscount1 - item.sellerDiscount2;
    orders.set(item.orderId, group);
  });

  const costs = pricingDatabase && pricingDatabase.costs && typeof pricingDatabase.costs === 'object' ? pricingDatabase.costs : {};
  const missingCosts = new Set();
  const output = rows.map((item) => {
    const row = item.row;
    const order = orders.get(item.orderId);
    const share = order.totalPrice ? item.subtotal / order.totalPrice : 0;
    const status = statusFor(row[ix.orderStatus], row[ix.returnStatus], row[ix.paidAt]);
    const cancelled = status === 'Cancelado' || status === 'Não pago';
    const returned = status === 'Devolução';
    const inactive = cancelled || returned;
    const commission = inactive ? 0 : -(item.grossCommission + item.grossService) * share;
    const directDiscount = item.sellerCoupon + item.sellerCashback;
    const cashBase = order.cashDiscount - item.campaignAdjustment;
    const cashDiscount = cashBase <= 0 ? -cashBase : 0;
    const discount = inactive ? 0 : -(directDiscount + cashDiscount) * share;
    const rebate = inactive ? 0 : (item.campaignIncentive + item.campaignAdjustment + item.shopeeBundleDiscount) * share;
    const revenue = inactive ? 0 : item.shopeeBundleDiscount * share + item.subtotal;
    const appliedFreight = inactive ? 0 : freight;
    const reverseFreight = returned ? item.reverseShipping : 0;
    const liquid = inactive ? reverseFreight : revenue + rebate + discount + commission + appliedFreight;
    const anticipation = inactive ? 0 : liquid * -anticipationRate;
    const tax = inactive ? 0 : -(revenue + discount) * taxRate;
    const fullSku = text(row[ix.sku]);
    const costSku = fullSku.split('-')[0];
    const costRecord = Object.prototype.hasOwnProperty.call(costs, costSku) ? costs[costSku] : null;
    const unitCost = costRecord && Number.isFinite(Number(costRecord.productCost)) ? Number(costRecord.productCost) : null;
    if (unitCost == null && !inactive) missingCosts.add(costSku || '(SKU vazio)');
    const productCost = inactive ? 0 : unitCost == null ? '' : -unitCost * item.quantity;
    const grossMargin = inactive ? liquid : unitCost == null ? '' : liquid + tax + productCost + anticipation;
    const grossMarginPercent = inactive ? 0 : unitCost == null || !revenue ? '' : grossMargin / revenue;
    const paidAt = text(row[ix.paidAt]);
    const createdAt = text(row[ix.createdAt]);
    const fullDate = paidAt && paidAt !== '-' ? paidAt : createdAt;
    return [
      'Shopee', text(payload.channelName), item.orderId, fullDate, dateOnly(fullDate), text(row[ix.orderStatus]),
      status, text(row[ix.shippingOption]), fullSku,
      text(row[ix.productName]), costSku, item.agreedPrice, item.quantity, revenue, discount, rebate, commission,
      appliedFreight, reverseFreight, liquid, anticipation, tax, productCost, grossMargin, grossMarginPercent
    ];
  });

  return { headers: OUTPUT_HEADERS, rows: output, summary: { lines: output.length, missingCostSkus: missingCosts.size, missingCostSkuList: Array.from(missingCosts).slice(0, 100) } };
}

module.exports = { OUTPUT_HEADERS, transformShopee };
