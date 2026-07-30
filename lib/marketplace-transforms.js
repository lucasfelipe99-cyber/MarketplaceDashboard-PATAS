'use strict';

function text(value) { return value == null ? '' : String(value).trim(); }
function norm(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function number(value, label, line) {
  if (value == null || text(value) === '' || ['-', '--', 'não se aplica', 'nao se aplica'].includes(norm(value))) return 0;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error(`Valor inválido em '${label}', linha ${line}.`);
  }
  let cleaned = text(value).replace(/BRL|R\$/gi, '').replace(/\s/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(','), lastDot = cleaned.lastIndexOf('.');
    cleaned = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) cleaned = cleaned.replace(',', '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Valor inválido em '${label}', linha ${line}: ${text(value)}.`);
  return parsed;
}
function dateOnly(value) {
  const raw = text(value);
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
function records(headers, rows, required, source) {
  const map = new Map(headers.map((header, index) => [norm(header), index]));
  const missing = required.filter((header) => !map.has(norm(header)));
  if (missing.length) throw new Error(`Colunas ausentes em ${source}: ${missing.join(', ')}.`);
  return rows.filter((row) => Array.isArray(row) && row.some((value) => text(value))).map((row, index) => {
    const record = { _line: index + 2 };
    headers.forEach((header, column) => { record[header] = row[column]; });
    required.forEach((header) => { record[header] = row[map.get(norm(header))]; });
    return record;
  });
}
function value(record, name) {
  const key = Object.keys(record).find((candidate) => norm(candidate) === norm(name));
  return key == null ? '' : record[key];
}
function costMap(pricingDatabase) {
  const source = pricingDatabase && pricingDatabase.costs && typeof pricingDatabase.costs === 'object' ? pricingDatabase.costs : {};
  const result = new Map();
  Object.keys(source).forEach((sku) => {
    const amount = Number(source[sku] && source[sku].productCost);
    if (Number.isFinite(amount)) result.set(text(sku), amount);
  });
  return result;
}
function costResult(costs, sku, quantity, missing, zero) {
  if (zero) return 0;
  if (!costs.has(sku)) { missing.add(sku || '(SKU vazio)'); return ''; }
  return -costs.get(sku) * quantity;
}

const TIKTOK_HEADERS = [
  'Marketplace', 'Marketplace venda', 'Order ID', 'Created Time', 'Data', 'Order Status', 'Status',
  'Fulfillment Type', 'SKU ID', 'Product Name', 'Seller SKU', 'Preço Unitário', 'Quantity', 'Faturamento',
  'Desconto', 'Rebate', 'Comissão', 'Frete', 'Cancelamento', 'Líquido', 'Antecipa', 'Imposto',
  'Custo do produto', 'Gross margin', 'Gross margin %'
];
const TIKTOK_REQUIRED = ['Order ID', 'Order Status', 'SKU ID', 'Seller SKU', 'Product Name', 'Quantity', 'SKU Subtotal Before Discount', 'SKU Seller Discount', 'Created Time', 'Fulfillment Type'];
function transformTikTok(payload, pricingDatabase) {
  const source = records(payload.headers || [], payload.rows || [], TIKTOK_REQUIRED, 'relatório TikTok');
  const costs = costMap(pricingDatabase), missing = new Set(), taxRate = Number(payload.taxRate) / 100;
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) throw new Error('Alíquota de imposto inválida.');
  const output = source.filter((row) => text(value(row, 'Order ID')) && !['Platform unique order ID.', 'x'].includes(text(value(row, 'Order ID')))).map((row) => {
    const quantity = number(value(row, 'Quantity'), 'Quantity', row._line);
    if (!Number.isInteger(quantity)) throw new Error(`A coluna 'Quantity' contém valor inválido na linha ${row._line}.`);
    const subtotal = number(value(row, 'SKU Subtotal Before Discount'), 'SKU Subtotal Before Discount', row._line);
    const sellerDiscount = number(value(row, 'SKU Seller Discount'), 'SKU Seller Discount', row._line);
    const revenue = subtotal - sellerDiscount, date = dateOnly(value(row, 'Created Time'));
    if (!date) throw new Error(`Data inválida em 'Created Time', linha ${row._line}.`);
    const newRule = date > '2026-07-14', below50 = revenue < 50;
    let commission = revenue ? revenue * (newRule && below50 ? -0.10 : -0.06) : 0;
    let freight = revenue ? revenue * -0.06 - (newRule && !below50 ? 6 : 4) : 0;
    const orderStatus = text(value(row, 'Order Status'));
    let status = ['Enviado', 'A ser enviado', 'Para enviar'].includes(orderStatus) ? 'Venda' : orderStatus === 'Cancelado' ? 'Cancelado' : 'Não pago';
    if (!revenue) status = 'Amostra Grátis';
    const cancelled=status==='Cancelado'||status==='Não pago';
    if(cancelled){commission=0;freight=0;}
    const cancellation=cancelled?-revenue:0,liquid = cancelled?0:revenue + commission + freight, tax = cancelled?0:-taxRate * revenue, sku = text(value(row, 'Seller SKU'));
    const productCost = costResult(costs, sku, quantity, missing, cancelled||status === 'Amostra Grátis');
    const margin = productCost === '' ? '' : liquid + tax + productCost;
    return ['TikTok', text(payload.channelName), text(value(row, 'Order ID')), value(row, 'Created Time'), date, orderStatus, status,
      value(row, 'Fulfillment Type'), value(row, 'SKU ID'), value(row, 'Product Name'), sku, quantity ? revenue / quantity : '', quantity,
      revenue, 0, 0, commission, freight, cancellation, liquid, 0, tax, productCost, margin,
      margin === '' ? '' : status === 'Amostra Grátis' ? 0 : revenue ? margin / revenue : ''];
  });
  return { headers: TIKTOK_HEADERS, rows: output, summary: { lines: output.length, missingCostSkus: missing.size, cancelled: output.filter((row) => row[6] === 'Cancelado').length, freeSamples: output.filter((row) => row[6] === 'Amostra Grátis').length } };
}

const AMAZON_HEADERS = ['Marketplace','Marketplace venda','amazon-order-id','purchase-date','Data','order-status','Status','fulfillment-channel','asin','product-name','SKU.1','Preço Unitário','quantity','Faturamento','item-promotion-discount','Rebate','Comissão','Frete','Cancelamento','Liquido','Antecipa','Imposto','Custo do produto','Margin R$','Margin %'];
const AMAZON_BASE_REQUIRED = ['amazon-order-id','purchase-date','order-status','fulfillment-channel','product-name','sku','asin','quantity','item-price','item-tax','shipping-tax','item-promotion-discount','ship-promotion-discount'];
const AMAZON_UNIFIED_REQUIRED = ['tipo','id do pedido','sku','descrição','quantidade','vendas do produto','créditos de remessa','descontos promocionais','imposto de vendas coletados','tarifas de venda','taxas fba','taxas de outras transações'];
const AMAZON_RECEIVABLE_REQUIRED = ['Tipo de transação','ID do pedido','Detalhes do produto','Tarifas da Amazon','Outros'];
function amazonSku(raw) {
  let sku = text(raw);
  if (sku.startsWith('FBA')) sku = sku.includes('-') ? sku.split('-').slice(1).join('-') : sku;
  sku = sku.split('-')[0];
  return ({ '4F':'GA1147', '1222':'GA1222', '8V':'GA1266', '57':'GA1209', '87':'GA1222' })[sku] || sku;
}
function transformAmazon(payload, pricingDatabase) {
  const sales = records(payload.salesHeaders || [], payload.salesRows || [], AMAZON_BASE_REQUIRED, 'pedidos Amazon');
  const unified = records(payload.unifiedHeaders || [], payload.unifiedRows || [], AMAZON_UNIFIED_REQUIRED, 'relatório unificado Amazon');
  const receivable = records(payload.receivableHeaders || [], payload.receivableRows || [], AMAZON_RECEIVABLE_REQUIRED, 'transações a receber Amazon');
  const taxRate = Number(payload.taxRate) / 100, costs = costMap(pricingDatabase), missing = new Set();
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) throw new Error('Alíquota de imposto inválida.');
  const shippingByOrder = new Map();
  unified.forEach((row) => {
    const fba = number(value(row, 'taxas fba'), 'taxas fba', row._line);
    const handling = text(value(row, 'descrição')) === 'Tarifa de manuseio com base no peso Delivery by Amazon';
    const amount = handling ? number(value(row, 'taxas de outras transações'), 'taxas de outras transações', row._line) : fba;
    const order = text(value(row, 'id do pedido'));
    if (amount && !shippingByOrder.has(order)) shippingByOrder.set(order, amount);
  });
  const tariffs = new Map(), averages = new Map();
  unified.filter((row) => text(value(row, 'tipo')) === 'Pedido').forEach((row) => {
    const order = text(value(row, 'id do pedido')), sku = text(value(row, 'sku')), key = order + '||' + sku;
    const current = tariffs.get(key) || { quantity:0, sales:0, commission:0, freight:0, freightCustomer:0 };
    current.quantity += number(value(row, 'quantidade'), 'quantidade', row._line);
    current.sales += number(value(row, 'vendas do produto'), 'vendas do produto', row._line);
    current.commission += number(value(row, 'tarifas de venda'), 'tarifas de venda', row._line);
    current.freight += shippingByOrder.get(order) || 0;
    current.freightCustomer += number(value(row, 'créditos de remessa'), 'créditos de remessa', row._line);
    tariffs.set(key, current);
  });
  tariffs.forEach((item, key) => { if (item.quantity === 1 && !averages.has(key.split('||')[1])) averages.set(key.split('||')[1], { commission:item.sales ? item.commission/item.sales : 0, freight:item.sales ? item.freight/item.sales : 0 }); });
  const receivableByOrder = new Map();
  receivable.filter((row) => text(value(row, 'Tipo de transação')) !== 'Reembolso').forEach((row) => {
    const order = text(value(row, 'ID do pedido')), current = receivableByOrder.get(order) || { totalFreight:0, fees:0, other:0, count:0 };
    const fee = number(value(row, 'Tarifas da Amazon'), 'Tarifas da Amazon', row._line), other = number(value(row, 'Outros'), 'Outros', row._line);
    if (text(value(row, 'Detalhes do produto')) === 'Faturamento') current.totalFreight += fee; else current.fees += fee;
    current.other += other; current.count += 1; receivableByOrder.set(order, current);
  });
  const orderCounts = new Map(); sales.forEach((row) => { const order=text(value(row,'amazon-order-id')); orderCounts.set(order,(orderCounts.get(order)||0)+1); });
  const sellingStatuses = new Set(['Pending - Waiting for Pick Up','Shipped - Picked Up','Shipped - Out for Delivery','Shipped - Delivered to Buyer','Shipped - Undeliverable','Shipped']);
  const returnStatuses = new Set(['Shipped - Returning to Seller','Shipped - Returned to Seller','Shipped - Lost in Transit']);
  const output = sales.map((row) => {
    const order = text(value(row,'amazon-order-id')), rawSku=text(value(row,'sku')), quantity=Math.trunc(number(value(row,'quantity'),'quantity',row._line));
    const statusRaw=text(value(row,'order-status')); let status=sellingStatuses.has(statusRaw)?'Venda':statusRaw==='Pending'?'Não pago':statusRaw==='Cancelled'?'Cancelado':returnStatuses.has(statusRaw)?'Devolução':0;
    const itemPrice=number(value(row,'item-price'),'item-price',row._line), itemTax=number(value(row,'item-tax'),'item-tax',row._line), shippingTax=number(value(row,'shipping-tax'),'shipping-tax',row._line);
    const revenue=status==='Venda'?itemPrice+itemTax+shippingTax:0, discount=-number(value(row,'item-promotion-discount'),'item-promotion-discount',row._line);
    const unifiedItem=tariffs.get(order+'||'+rawSku), receivableItem=receivableByOrder.get(order), average=averages.get(rawSku), count=orderCounts.get(order)||1;
    let commission=unifiedItem?unifiedItem.commission:receivableItem?receivableItem.fees:average?average.commission*revenue:NaN;
    if (status!=='Venda') commission=0; else if (!Number.isFinite(commission)||commission===0) commission=-0.13*revenue;
    const shipDiscount=-number(value(row,'ship-promotion-discount'),'ship-promotion-discount',row._line), fba=text(value(row,'fulfillment-channel'))==='Amazon';
    let freight;
    if (unifiedItem) freight=fba?unifiedItem.freight+unifiedItem.freightCustomer+shipDiscount:unifiedItem.freight/count;
    else if (receivableItem) { const fallback=receivableItem.count===1?0:receivableItem.totalFreight+receivableItem.other; freight=fba?fallback:fallback/count; }
    else freight=average?average.freight*revenue:NaN;
    if (status==='Cancelado'||status==='Não pago') freight=0;
    else if(status==='Devolução') freight=Number.isFinite(freight)?freight:0;
    else if (!Number.isFinite(freight)||freight===0) freight=revenue<78?-6.75:-19.50;
    const liquid=status==='Venda'?revenue+freight+commission+discount:status==='Devolução'?freight:0, tax=status==='Venda'?-taxRate*(revenue+discount):0, sku=amazonSku(rawSku);
    const productCost=costResult(costs,sku,quantity,missing,status!=='Venda'), margin=productCost===''?'':liquid+tax+productCost;
    return ['Amazon',text(payload.channelName),order,value(row,'purchase-date'),dateOnly(value(row,'purchase-date')),statusRaw,status,value(row,'fulfillment-channel'),value(row,'asin'),value(row,'product-name'),sku,quantity?revenue/quantity:0,quantity,revenue,discount,0,commission,freight,0,liquid,0,tax,productCost,margin,margin===''?'':status==='Venda'&&revenue?margin/revenue:0];
  });
  return { headers:AMAZON_HEADERS, rows:output, summary:{ lines:output.length, missingCostSkus:missing.size, missingFees:output.filter((row)=>row[16]==='').length, cancelled:output.filter((row)=>row[6]==='Cancelado').length, returns:output.filter((row)=>row[6]==='Devolução').length } };
}

const MAGALU_HEADERS=['Marketplace','Marketplace venda','Número do pedido','Data do Pedido','Data','Status pacote no momento que o relatório foi solicitado','Status','Modalidade de entrega','Codigo SKU seller','Título do produto','SKU.1','Valor Total do Item','Quantidade de itens','Fat','Desconto','Rebate','Comissão','Frete','Cancelamento','Liquido','Antecipa','Imposto','Custo do produto','Gross margin','Gross margin %'];
const MAGALU_ORDERS_REQUIRED=['Data do Pedido','Número do pedido','Codigo SKU seller','Título do produto','Quantidade de itens','Valor Total do Item','Valor bruto do pedido','Coparticipação de Fretes estimada','Pago pelo Parceiro (Coparticipação de Desconto à Vista)','Pago pelo Magalu (Coparticipação de Desconto à Vista)','Pago pelo Magalu (Coparticipação de Preço Promocional)','Pago pelo Parceiro (Coparticipação de Preço Promocional)','Pago pelo Magalu (Valor subsídio Cupom)','Pago pelo Parceiro (Valor subsídio Cupom)','Tarifa fixa (Forma de pagamento 1)','Tarifa fixa (Forma de pagamento 2)','Serviços do marketplace (1+2+3+4) (Forma de pagamento 1)'];
const MAGALU_PACKAGES_REQUIRED=['Número do pedido','Status pacote no momento que o relatório foi solicitado','Modalidade de entrega'];
function magaluSku(raw, idMap) { const code=text(raw); if(idMap&&idMap[code]) return idMap[code]; if(code.startsWith('GA')) { let base=code.split('-')[0]; if(base.endsWith('VA'))base=base.slice(0,-2); else if(base.endsWith('V'))base=base.slice(0,-1); return base; } return code; }
function transformMagalu(payload, pricingDatabase, idMap) {
  const orders=records(payload.orderHeaders||[],payload.orderRows||[],MAGALU_ORDERS_REQUIRED,'pedidos Magalu');
  const packages=records(payload.packageHeaders||[],payload.packageRows||[],MAGALU_PACKAGES_REQUIRED,'pacotes Magalu');
  const packageMap=new Map(); packages.forEach((row)=>{const id=text(value(row,'Número do pedido'));if(!packageMap.has(id))packageMap.set(id,row);});
  const costs=costMap(pricingDatabase),missing=new Set(),taxRate=Number(payload.taxRate)/100;
  const items=orders.map((row)=>{const quantity=number(value(row,'Quantidade de itens'),'Quantidade de itens',row._line);if(!Number.isInteger(quantity))throw new Error(`Quantidade inválida na linha ${row._line}.`);const money={};MAGALU_ORDERS_REQUIRED.slice(5).forEach((name)=>{money[name]=number(value(row,name),name,row._line);});const fat=quantity*money['Valor Total do Item'];return {row,quantity,money,fat,order:text(value(row,'Número do pedido'))};});
  const summaries=new Map();items.forEach((item)=>{const s=summaries.get(item.order)||{promo:0,visible:0,total:0,count:0,eligible:0};const m=item.money;s.promo+=m['Pago pelo Parceiro (Coparticipação de Preço Promocional)'];s.visible+=m['Pago pelo Parceiro (Coparticipação de Desconto à Vista)']-m['Pago pelo Magalu (Coparticipação de Desconto à Vista)']-m['Pago pelo Magalu (Valor subsídio Cupom)']+m['Pago pelo Parceiro (Valor subsídio Cupom)']-m['Pago pelo Magalu (Coparticipação de Preço Promocional)'];s.total+=item.fat;s.count+=1;s.eligible+=m['Valor Total do Item']>78.99?1:0;summaries.set(item.order,s);});
  const sold=new Set(['Nota fiscal gerada e aprovada','Pedido despachado','Pedido entregue']);
  const output=items.map((item)=>{
    const row=item.row,m=item.money,s=summaries.get(item.order),pack=packageMap.get(item.order)||{};
    const statusRaw=text(value(pack,'Status pacote no momento que o relatório foi solicitado')),status=sold.has(statusRaw)?'Venda':'Cancelado',cancelled=status==='Cancelado';
    const visible=m['Pago pelo Parceiro (Coparticipação de Desconto à Vista)']-m['Pago pelo Magalu (Coparticipação de Desconto à Vista)']-m['Pago pelo Magalu (Valor subsídio Cupom)']+m['Pago pelo Parceiro (Valor subsídio Cupom)']-m['Pago pelo Magalu (Coparticipação de Preço Promocional)'];
    const difference=m['Valor bruto do pedido']-(s.total+s.visible),hidden=difference<=0&&s.promo?m['Pago pelo Parceiro (Coparticipação de Preço Promocional)']/s.promo*difference:0;
    const discount=cancelled?0:visible+hidden,rebate=cancelled?0:m['Pago pelo Magalu (Coparticipação de Desconto à Vista)']+m['Pago pelo Magalu (Coparticipação de Preço Promocional)']+m['Pago pelo Magalu (Valor subsídio Cupom)'];
    const fee2Raw=norm(value(row,'Tarifa fixa (Forma de pagamento 2)')),fixed=m['Tarifa fixa (Forma de pagamento 1)']+(fee2Raw==='nao se aplica'?0:m['Tarifa fixa (Forma de pagamento 2)']);
    const fixedAllocated=fixed===0?-5*item.quantity:fixed/s.count,variable=(s.total?item.fat/s.total:0)*m['Serviços do marketplace (1+2+3+4) (Forma de pagamento 1)'];
    const commission=cancelled?0:fixedAllocated+variable,eligible=m['Valor Total do Item']>78.99,freight=cancelled?0:m['Coparticipação de Fretes estimada']!==0&&eligible&&s.eligible?m['Coparticipação de Fretes estimada']/s.eligible:0;
    const cancellation=cancelled?-item.fat:0,liquid=cancelled?0:item.fat+discount+rebate+commission+freight,tax=cancelled?0:-taxRate*(item.fat+discount);
    const code=text(value(row,'Codigo SKU seller')),sku=magaluSku(code,idMap),productCost=costResult(costs,sku,item.quantity,missing,cancelled),margin=productCost===''?'':liquid+tax+productCost;
    return ['Magalu',text(payload.channelName),item.order,value(row,'Data do Pedido'),dateOnly(value(row,'Data do Pedido')),statusRaw,status,value(pack,'Modalidade de entrega'),code,value(row,'Título do produto'),sku,m['Valor Total do Item'],item.quantity,item.fat,discount,rebate,commission,freight,cancellation,liquid,0,tax,productCost,margin,margin===''?'':cancelled?0:item.fat?margin/item.fat:''];
  });
  return {headers:MAGALU_HEADERS,rows:output,summary:{lines:output.length,missingCostSkus:missing.size,cancelled:output.filter((row)=>row[6]==='Cancelado').length}};
}

module.exports={TIKTOK_HEADERS,AMAZON_HEADERS,MAGALU_HEADERS,transformTikTok,transformAmazon,transformMagalu};
