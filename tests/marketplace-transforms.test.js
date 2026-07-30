'use strict';
const assert = require('assert');
const { transformTikTok, transformAmazon, transformMagalu } = require('../lib/marketplace-transforms');
const db = { costs: { GA903:{productCost:15.1513}, GA100:{productCost:20}, GA1219:{productCost:16.2988} } };
const matrix = (records) => ({ headers:Object.keys(records[0]), rows:records.map((record)=>Object.values(record)) });

const tik = matrix([{ 'Order ID':'585277532531557414','Order Status':'A ser enviado','SKU ID':'1736376643662677071','Seller SKU':'GA903','Product Name':'Produto','Quantity':'1','SKU Subtotal Before Discount':'BRL 98,90','SKU Seller Discount':'BRL 52,91','Created Time':'07/29/2026 11:03:50 PM','Fulfillment Type':'Fulfillment by seller' }]);
let result=transformTikTok({...tik,channelName:'Box fan',taxRate:14},db);
assert.equal(result.rows[0][6],'Venda');assert(Math.abs(result.rows[0][13]-45.99)<1e-9);assert(Math.abs(result.rows[0][23]-13.0417)<1e-6);
const tikCancelled=matrix([{ 'Order ID':'C-1','Order Status':'Cancelado','SKU ID':'SKU-C','Seller SKU':'GA903','Product Name':'Cancelado','Quantity':'1','SKU Subtotal Before Discount':'BRL 45,99','SKU Seller Discount':'BRL 0','Created Time':'07/29/2026 11:03:50 PM','Fulfillment Type':'Fulfillment by seller' }]);
result=transformTikTok({...tikCancelled,channelName:'Box fan',taxRate:14},db);
assert.equal(result.rows[0][6],'Cancelado');assert.equal(result.rows[0][16],0);assert.equal(result.rows[0][17],0);assert.equal(result.rows[0][18],-45.99);assert.equal(result.rows[0][19],0);assert.equal(result.rows[0][21],0);assert.equal(result.rows[0][22],0);

const sale=matrix([{ 'amazon-order-id':'701-1','purchase-date':'2026-07-01T10:00:00+00:00','order-status':'Shipped','fulfillment-channel':'Merchant','product-name':'Produto','sku':'GA100-1','asin':'B001','quantity':'1','item-price':'100','item-tax':'','shipping-tax':'','item-promotion-discount':'5','ship-promotion-discount':'2' }]);
const unified=matrix([{tipo:'Pedido','id do pedido':'701-1',sku:'GA100-1','descrição':'Produto',quantidade:'1','vendas do produto':'100,00','créditos de remessa':'10,00','descontos promocionais':'-5,00','imposto de vendas coletados':'0','tarifas de venda':'-15,00','taxas fba':'0','taxas de outras transações':'0'},{tipo:'Serviços de Envio','id do pedido':'701-1',sku:'','descrição':'Tarifa de manuseio com base no peso Delivery by Amazon',quantidade:'','vendas do produto':'0','créditos de remessa':'0','descontos promocionais':'0','imposto de vendas coletados':'0','tarifas de venda':'0','taxas fba':'0','taxas de outras transações':'-6,00'}]);
const receivable={headers:['Tipo de transação','ID do pedido','Detalhes do produto','Tarifas da Amazon','Outros'],rows:[]};
result=transformAmazon({salesHeaders:sale.headers,salesRows:sale.rows,unifiedHeaders:unified.headers,unifiedRows:unified.rows,receivableHeaders:receivable.headers,receivableRows:receivable.rows,channelName:'Box fan',taxRate:14},db);
assert.equal(result.rows[0][10],'GA100');assert.equal(result.rows[0][16],-15);assert.equal(result.rows[0][17],-6);assert(Math.abs(result.rows[0][23]-40.7)<1e-9);

const order=matrix([{ 'Data do Pedido':'01/07/2026 07:01:36','Número do pedido':'LU-1','Codigo SKU seller':'16000000000','Título do produto':'Produto','Quantidade de itens':1,'Valor Total do Item':'R$ 60.11','Valor bruto do pedido':'R$ 48.08','Coparticipação de Fretes estimada':'R$ -2.40','Pago pelo Parceiro (Coparticipação de Desconto à Vista)':'R$ -3.91','Pago pelo Magalu (Coparticipação de Desconto à Vista)':'R$ 3.92','Pago pelo Magalu (Coparticipação de Preço Promocional)':'R$ 0','Pago pelo Parceiro (Coparticipação de Preço Promocional)':'R$ 0','Pago pelo Magalu (Valor subsídio Cupom)':'R$ 0','Pago pelo Parceiro (Valor subsídio Cupom)':'R$ -4.20','Tarifa fixa (Forma de pagamento 1)':'R$ -5.00','Tarifa fixa (Forma de pagamento 2)':'Não se aplica','Serviços do marketplace (1+2+3+4) (Forma de pagamento 1)':'R$ -9.36' }]);
const pack=matrix([{ 'Número do pedido':'LU-1','Status pacote no momento que o relatório foi solicitado':'Pedido entregue','Modalidade de entrega':'Magalu entregas - Coleta' }]);
result=transformMagalu({orderHeaders:order.headers,orderRows:order.rows,packageHeaders:pack.headers,packageRows:pack.rows,channelName:'Box fan',taxRate:14},db,{'16000000000':'GA1219'});
assert.equal(result.rows[0][10],'GA1219');assert(Math.abs(result.rows[0][14]+12.03)<1e-9);assert(Math.abs(result.rows[0][23]-14.61)<1e-6);
const cancelledPack=matrix([{ 'Número do pedido':'LU-1','Status pacote no momento que o relatório foi solicitado':'Pedido cancelado','Modalidade de entrega':'Magalu entregas - Coleta' }]);
result=transformMagalu({orderHeaders:order.headers,orderRows:order.rows,packageHeaders:cancelledPack.headers,packageRows:cancelledPack.rows,channelName:'Box fan',taxRate:14},db,{'16000000000':'GA1219'});
assert.equal(result.rows[0][6],'Cancelado');assert.equal(result.rows[0][16],0);assert.equal(result.rows[0][17],0);assert.equal(result.rows[0][18],-60.11);assert.equal(result.rows[0][19],0);assert.equal(result.rows[0][21],0);assert.equal(result.rows[0][22],0);
console.log('Marketplace transforms tests: PASS');
