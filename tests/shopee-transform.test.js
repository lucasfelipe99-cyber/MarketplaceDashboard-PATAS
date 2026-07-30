'use strict';

const assert = require('assert');
const { transformShopee, OUTPUT_HEADERS } = require('../lib/shopee-transform');

const headers = [
  'ID do pedido', 'Status do pedido', 'Status da Devolução / Reembolso', 'Hora do pagamento do pedido',
  'Data de criação do pedido', 'Opção de envio', 'Nome do Produto', 'Número de referência SKU',
  'Preço acordado', 'Quantidade', 'Subtotal do produto', 'Desconto do vendedor', 'Desconto do vendedor',
  'Incentivo Shopee para ação comercial', 'Ajuste por participação em ação comercial', 'Cupom do vendedor',
  'Coin Cashback Voucher Amount Sponsored by Seller', 'Desconto Shopee da Leve Mais por Menos',
  'Desconto da Leve Mais por Menos do vendedor', 'Taxa de Envio Reversa', 'Taxa de comissão bruta', 'Taxa de serviço bruta'
];

const rows = [
  ['P1', 'Concluído', '', '2026-07-01 10:00', '2026-07-01 09:00', 'Shopee Xpress', 'Produto A', 'GA954-1', 60, 2, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 4],
  ['P1', 'Concluído', '', '2026-07-01 10:00', '2026-07-01 09:00', 'Shopee Xpress', 'Produto B', 'GA1196', 30, 1, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 4]
];

const result = transformShopee({ headers, rows, channelName: 'Box fan', taxRate: 14, anticipationRate: 2.5, freight: 0 }, {
  costs: { GA954: { productCost: 10 } }
});

assert.deepStrictEqual(result.headers, OUTPUT_HEADERS);
assert.strictEqual(result.rows.length, 2);
assert.strictEqual(result.rows[0][0], 'Shopee');
assert.strictEqual(result.rows[0][8], 'GA954-1', 'ID do Produto deve manter o SKU completo');
assert.strictEqual(result.rows[0][10], 'GA954', 'SKU de custo deve ser truncado no primeiro hífen');
assert.strictEqual(result.rows[0][22], -20, 'CMV deve multiplicar custo unitário pela quantidade');
assert.strictEqual(result.rows[1][8], 'GA1196');
assert.strictEqual(result.rows[1][10], 'GA1196');
assert.strictEqual(result.rows[1][22], '', 'SKU sem custo não deve bloquear nem receber CMV');
assert.strictEqual(result.rows[1][23], '');
assert.strictEqual(result.rows[1][24], '');
assert.strictEqual(result.summary.missingCostSkus, 1);
assert.ok(Math.abs(result.rows[0][16] - -19.2) < 1e-9, 'Comissão deve ser rateada pela participação no subtotal do pedido');
assert.ok(Math.abs(result.rows[1][16] - -4.8) < 1e-9, 'Comissão deve reconciliar no pedido');
assert.strictEqual(result.rows[0][4], '2026-07-01');

const inactiveRows = [
  ['C1', 'Cancelado', '', '-', '2026-07-02 09:00', 'Shopee Xpress', 'Produto cancelado', 'GA954-1', 60, 1, 60, 0, 0, 0, 0, 0, 0, 0, 0, -9, 10, 2],
  ['D1', 'Concluído', 'Devolução aprovada', '2026-07-03 10:00', '2026-07-03 09:00', 'Shopee Xpress', 'Produto devolvido', 'GA954-1', 60, 1, 60, 0, 0, 0, 0, 0, 0, 0, 0, -9, 10, 2]
];
const inactiveResult = transformShopee({ headers, rows: inactiveRows, channelName: 'Box fan', taxRate: 14, anticipationRate: 2.5, freight: -7 }, {
  costs: { GA954: { productCost: 10 } }
});
const cancelled = inactiveResult.rows[0], returned = inactiveResult.rows[1];
assert.strictEqual(cancelled[6], 'Cancelado');
assert.strictEqual(cancelled[16], 0, 'Cancelado não deve ter comissão');
assert.strictEqual(cancelled[17], 0, 'Cancelado não deve ter frete normal');
assert.strictEqual(cancelled[21], 0, 'Cancelado não deve ter imposto');
assert.strictEqual(cancelled[22], 0, 'Cancelado não deve ter CMV');
assert.strictEqual(returned[6], 'Devolução');
assert.strictEqual(returned[16], 0, 'Devolução não deve ter comissão');
assert.strictEqual(returned[17], 0, 'Devolução não deve ter frete normal');
assert.strictEqual(returned[18], -9, 'Devolução deve preservar apenas o frete reverso');
assert.strictEqual(returned[19], -9, 'Frete reverso deve compor o líquido da devolução');
assert.strictEqual(returned[21], 0, 'Devolução não deve ter imposto');
assert.strictEqual(returned[22], 0, 'Devolução não deve ter CMV');

console.log('Shopee transform tests: PASS');
