(function () {
  'use strict';

  var calculatorContainer = document.getElementById('pricingCalculatorContainer');
  var costContainer = document.getElementById('pricingCostContainer');
  var rulesContainer = document.getElementById('pricingRulesContainer');
  if (!calculatorContainer || !costContainer || !rulesContainer) return;

  var master = { categories: [], skus: {} };
  var rulesState = { rules: [], source: '' };
  var database = { costs: {}, lastPricing: {} };
  var platforms = [
    { id: 'mercado-livre', label: 'Mercado Livre' },
    { id: 'shopee', label: 'Shopee' },
    { id: 'amazon-dba', label: 'Amazon' },
    { id: 'magalu', label: 'Magalu' },
    { id: 'tiktok', label: 'TikTok Shop' },
    { id: 'shein', label: 'Shein' }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function number(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function money(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number(value)); }
  function percent(value) { return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number(value)); }
  function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }

  async function loadData() {
    var responses = await Promise.all([
      fetch('/api/product-master', { cache: 'no-store' }),
      fetch('/api/pricing-rules', { cache: 'no-store' }),
      fetch('/api/pricing-database', { cache: 'no-store' })
    ]);
    if (responses.some(function (response) { return !response.ok; })) throw new Error('Não foi possível carregar a precificação.');
    master = await responses[0].json();
    rulesState = await responses[1].json();
    database = await responses[2].json();
    database.lastPricing = database.lastPricing || {};
  }
  async function postJson(url, payload) {
    var response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    return result;
  }
  async function saveDatabase(payload) {
    database = await postJson('/api/pricing-database', payload);
    database.lastPricing = database.lastPricing || {};
  }
  function allSkus() {
    var map = {};
    Object.values(master.skus || {}).forEach(function (item) { if (item.sku) map[item.sku] = item; });
    Object.values(database.costs || {}).forEach(function (item) { if (item.sku) map[item.sku] = Object.assign({}, map[item.sku], item); });
    return Object.values(map).sort(function (a, b) { return String(a.sku).localeCompare(String(b.sku), 'pt-BR'); });
  }
  function skuOptions() {
    return allSkus().map(function (item) { return '<option value="' + escapeHtml(item.sku) + '">' + escapeHtml(item.description || '') + '</option>'; }).join('');
  }
  function skuInfo(sku) {
    return Object.assign({}, (master.skus || {})[sku] || {}, (database.costs || {})[sku] || {}, { sku: sku });
  }
  function ruleById(id) {
    return (rulesState.rules || []).find(function (rule) { return rule.id === id; }) || {};
  }
  function localizedNumber(value) {
    var text = String(value == null ? '' : value).trim().replace(/\s/g, '');
    if (!text) return 0;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    var parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function csvCells(line) {
    var cells = [], current = '', quoted = false;
    for (var index = 0; index < line.length; index += 1) {
      var character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === ';' && !quoted) {
        cells.push(current); current = '';
      } else current += character;
    }
    cells.push(current);
    return cells;
  }
  function normalizeHeader(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }
  function parseProductCsv(text) {
    var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (line) { return line.trim(); });
    if (lines.length < 2) throw new Error('O arquivo não possui produtos.');
    var headers = csvCells(lines[0]).map(normalizeHeader);
    var positions = {
      SKU: headers.indexOf('SKU'),
      DESCRICAO: headers.findIndex(function (header) { return header.startsWith('DESCRI'); }),
      CUSTO: headers.indexOf('CUSTO'),
      ALTURA: headers.indexOf('ALTURA'),
      LARGURA: headers.indexOf('LARGURA'),
      COMPR: headers.indexOf('COMPR'),
      PESOREAL: headers.indexOf('PESOREAL')
    };
    var missing = Object.keys(positions).filter(function (header) { return positions[header] < 0; });
    if (missing.length) throw new Error('Colunas ausentes: ' + missing.join(', ') + '.');
    var map = {}, duplicates = 0;
    lines.slice(1).forEach(function (line, rowIndex) {
      var cells = csvCells(line), sku = String(cells[positions.SKU] || '').trim();
      if (!sku) throw new Error('SKU vazio na linha ' + (rowIndex + 2) + '.');
      var cost = localizedNumber(cells[positions.CUSTO]);
      var height = localizedNumber(cells[positions.ALTURA]);
      var width = localizedNumber(cells[positions.LARGURA]);
      var length = localizedNumber(cells[positions.COMPR]);
      var weightGrams = localizedNumber(cells[positions.PESOREAL]);
      if ([cost, height, width, length, weightGrams].some(function (value) { return Number.isNaN(value); })) {
        throw new Error('Valor numérico inválido na linha ' + (rowIndex + 2) + '.');
      }
      if (map[sku]) duplicates += 1;
      map[sku] = {
        sku: sku,
        description: String(cells[positions.DESCRICAO] || '').trim(),
        category: '',
        productCost: cost,
        height: height,
        width: width,
        length: length,
        realWeight: weightGrams / 1000
      };
    });
    return { rows: Object.values(map), duplicates: duplicates };
  }

  function bracket(weight, rows) {
    for (var index = 0; index < rows.length; index += 1) if (weight <= rows[index][0]) return rows[index][1];
    return rows.length ? rows[rows.length - 1][1] : 0;
  }
  function priceColumn(price, limits) {
    for (var index = 0; index < limits.length; index += 1) if (price <= limits[index]) return index;
    return limits.length;
  }
  function matrixFee(price, weight, limits, rows) {
    var column = priceColumn(price, limits);
    for (var index = 0; index < rows.length; index += 1) if (weight <= rows[index][0]) return rows[index][column + 1] || 0;
    return rows[rows.length - 1][column + 1] || 0;
  }
  function marketplaceCharges(rule, price, weight) {
    var rate = number(rule.commissionRate) / 100, fixed = number(rule.fixedFee), freight = 0, mode = rule.freightMode;
    if (mode === 'shopee') {
      if (price <= 79.99) { rate = .20; fixed = 4; }
      else if (price <= 99.99) { rate = .14; fixed = 16; }
      else if (price <= 199.99) { rate = .14; fixed = 20; }
      else { rate = .14; fixed = 26; }
    } else if (mode === 'shein') {
      rate = .18;
      if (price < 79.99) fixed = 5;
      else freight = bracket(weight, [[.3,4],[.6,5],[.9,6],[1.2,8],[1.5,10],[2,12],[5,15],[9,32],[13,63],[17,73],[23,89],[30,106]]);
    } else if (mode === 'amazon-dba') {
      if (price < 30) freight = 4.5;
      else if (price < 50) freight = 6.5;
      else if (price < 79) freight = 6.75;
      else freight = matrixFee(price, weight, [99.99,119.99,149.99,199.99], [[.25,11.95,13.95,15.95,17.95,19.95],[.5,12.85,15,17.15,19.3,20.45],[1,13.45,15.7,17.95,20.2,21.45],[2,14,16.35,18.75,21.1,22.95],[3,14.95,17.45,19.95,22.4,23.95],[4,16.15,18.85,21.55,24.2,25.95],[5,17,19.9,22.75,25.6,27.95],[6,25,30,34,38,36.95],[10,39.5,46,52.75,59,61.45]]);
    } else if (mode === 'magalu') {
      freight = bracket(weight, [[.5,35.9],[1,40.9],[2,42.9],[5,50.9],[9,77.9],[13,98.9],[17,111.9],[23,134.9],[30,148.9],[50,189.9],[100,235.9],[200,360.9],[9999,375.9]]);
    } else if (mode === 'mercado-livre') {
      freight = matrixFee(price, weight, [18.99,48.99,78.99,99.99,119.99,149.99,199.99], [[.3,5.65,6.55,7.75,12.35,14.35,16.45,18.45,20.95],[.5,5.95,6.65,7.85,13.25,15.45,17.65,19.85,22.55],[1,6.05,6.75,7.95,13.85,16.15,18.45,20.75,23.65],[1.5,6.15,6.85,8.05,14.15,16.45,18.85,21.15,24.65],[2,6.25,6.95,8.15,14.45,16.85,19.25,21.65,24.65],[3,6.35,7.95,8.55,15.75,18.35,21.05,23.65,26.25],[4,6.45,8.15,8.95,17.05,19.85,22.65,25.55,28.35],[5,6.55,8.35,9.75,18.45,21.55,24.65,27.75,30.75]]);
    }
    return { rate: rate, fixed: fixed, freight: freight };
  }
  function calculate(input) {
    var price = input.salePrice;
    if (!price) {
      price = input.cmv / Math.max(.05, 1 - input.margin - input.coupon - input.ads - input.affiliates - input.tax - number(input.rule.commissionRate) / 100);
      for (var index = 0; index < 25; index += 1) {
        var iteration = marketplaceCharges(input.rule, price, input.weight);
        price = (input.cmv + iteration.fixed + iteration.freight) / Math.max(.05, 1 - input.margin - input.coupon - input.ads - input.affiliates - input.tax - iteration.rate);
      }
    }
    var charges = marketplaceCharges(input.rule, price, input.weight);
    var commission = price * charges.rate + charges.fixed;
    var coupon = price * input.coupon, ads = price * input.ads, affiliates = price * input.affiliates, tax = price * input.tax;
    var received = price - commission - charges.freight - coupon;
    var contribution = received - ads - affiliates - tax - input.cmv;
    return { price: price, commission: commission, freight: charges.freight, coupon: coupon, ads: ads, affiliates: affiliates, tax: tax, received: received, contribution: contribution, margin: price ? contribution / price : 0, roi: input.cmv ? contribution / input.cmv : 0 };
  }

  function renderCalculator() {
    var settings = {};
    platforms.forEach(function (platform) {
      var rule = ruleById(platform.id);
      settings[platform.id] = {
        commissionRate: number(rule.commissionRate), couponRate: number(rule.couponRate),
        adsRate: number(rule.adsRate), affiliatesRate: number(rule.affiliatesRate), taxRate: number(rule.taxRate)
      };
    });
    calculatorContainer.innerHTML = '<div class="pricing-page">' +
      '<section class="pricing-card pricing-hero"><div class="pricing-heading"><strong>Calculadora Comparativa de Precificação</strong><span>Um SKU, todos os marketplaces lado a lado.</span></div><span class="inventory-link">Última configuração por SKU</span></section>' +
      '<section class="pricing-card"><form class="pricing-form pricing-compare-form" id="pricingForm">' +
      '<div class="pricing-field"><label>SKU</label><input id="pricingSku" required list="pricingSkuList" autocomplete="off" placeholder="Pesquise o SKU"><datalist id="pricingSkuList">' + skuOptions() + '</datalist></div>' +
      '<div class="pricing-field wide"><label>Descrição do produto</label><input id="pricingDescription" required></div>' +
      '<div class="pricing-field"><label>Custo do produto</label><input id="pricingCmv" type="number" min="0" step=".01" required></div>' +
      '<div class="pricing-field" id="pricingSalePriceField"><label>Preço de venda desejado</label><input id="pricingSalePrice" type="number" min="0" step=".01" value="49.90"></div>' +
      '<div class="pricing-field" id="pricingMarginField" hidden><label>Margem desejada (%)</label><input id="pricingMargin" type="number" min="0" max="99" step=".01" value="20"></div>' +
      '<div class="pricing-field"><label>Peso real (kg)</label><input id="pricingWeight" type="number" min="0" step=".001" value=".5"></div>' +
      '<div class="pricing-field"><label>Altura (cm)</label><input id="pricingHeight" type="number" min="0" step=".01" value="0"></div>' +
      '<div class="pricing-field"><label>Largura (cm)</label><input id="pricingWidth" type="number" min="0" step=".01" value="0"></div>' +
      '<div class="pricing-field"><label>Comprimento (cm)</label><input id="pricingLength" type="number" min="0" step=".01" value="0"></div>' +
      '<div class="pricing-field"><label>Responsável</label><input id="pricingUser" required value="' + escapeHtml(localStorage.getItem('pricingLastUser') || '') + '"></div>' +
      '<div class="pricing-mode wide"><strong>Calcular por</strong><label class="pricing-mode-option"><input type="radio" name="pricingMode" value="price" checked><span><b>Preço de venda</b><small>Informe o preço e compare a margem resultante</small></span></label><label class="pricing-mode-option"><input type="radio" name="pricingMode" value="margin"><span><b>Margem desejada</b><small>Informe a margem e calcule o preço ideal</small></span></label></div>' +
      '<div class="pricing-market-select wide"><strong>Marketplaces exibidos</strong>' + platforms.map(function (platform) { return '<label><input class="pricing-market-check" type="checkbox" value="' + platform.id + '" checked> ' + platform.label + '</label>'; }).join('') + '</div>' +
      '<div class="pricing-actions"><button class="pricing-button primary" type="submit">Calcular e salvar última precificação</button></div></form><div class="pricing-status" id="pricingSaveStatus"></div></section>' +
      '<section class="pricing-card pricing-config"><div class="pricing-config-title"><strong>Configurações utilizadas por marketplace</strong><span>Altere os percentuais para simular; a tabela é atualizada automaticamente.</span></div><div id="pricingConfigGrid"></div></section>' +
      '<section class="pricing-card"><div id="pricingCompareTable"></div></section></div>';

    function selectedIds() {
      return Array.from(document.querySelectorAll('.pricing-market-check:checked')).map(function (input) { return input.value; });
    }
    function mode() { return document.querySelector('input[name="pricingMode"]:checked').value; }
    function updateModeFields() {
      var marginMode = mode() === 'margin';
      document.getElementById('pricingSalePriceField').hidden = marginMode;
      document.getElementById('pricingMarginField').hidden = !marginMode;
      document.querySelectorAll('.pricing-mode-option').forEach(function (option) {
        option.classList.toggle('active', option.querySelector('input').checked);
      });
    }
    function consideredWeight() {
      var cubed = number(document.getElementById('pricingHeight').value) * number(document.getElementById('pricingWidth').value) * number(document.getElementById('pricingLength').value) / 6000;
      return Math.max(number(document.getElementById('pricingWeight').value), cubed);
    }
    function renderConfig() {
      document.getElementById('pricingConfigGrid').innerHTML = platforms.map(function (platform) {
        var config = settings[platform.id];
        return '<div class="pricing-config-card" data-config="' + platform.id + '"><strong>' + platform.label + '</strong>' +
          [['commissionRate','Comissão'],['couponRate','Cupom'],['adsRate','ADS'],['affiliatesRate','Afiliados'],['taxRate','Imposto']].map(function (definition) {
            return '<label>' + definition[1] + ' (%)<input data-setting="' + definition[0] + '" type="number" min="0" max="99" step=".01" value="' + config[definition[0]] + '"></label>';
          }).join('') + '</div>';
      }).join('');
      document.querySelectorAll('[data-setting]').forEach(function (input) {
        input.addEventListener('input', function () {
          var card = input.closest('[data-config]');
          settings[card.dataset.config][input.dataset.setting] = number(input.value);
          recalculate();
        });
      });
    }
    function calculateAll() {
      var cmv = number(document.getElementById('pricingCmv').value);
      var salePrice = number(document.getElementById('pricingSalePrice').value);
      var margin = number(document.getElementById('pricingMargin').value) / 100;
      return selectedIds().map(function (id) {
        var platform = platforms.find(function (item) { return item.id === id; });
        var config = settings[id];
        var rule = Object.assign({}, ruleById(id), { commissionRate: config.commissionRate });
        return {
          id: id, label: platform.label,
          result: calculate({
            rule: rule, salePrice: mode() === 'price' ? salePrice : 0, cmv: cmv, weight: consideredWeight(), margin: margin,
            coupon: config.couponRate / 100, ads: config.adsRate / 100, affiliates: config.affiliatesRate / 100, tax: config.taxRate / 100
          })
        };
      });
    }
    function recalculate() {
      var calculated = calculateAll(), cmv = number(document.getElementById('pricingCmv').value);
      if (!calculated.length) return void (document.getElementById('pricingCompareTable').innerHTML = '<div class="pricing-empty">Selecione ao menos um marketplace.</div>');
      var indicators = [
        ['Preço de Venda','price','money'], ['Comissão','commission','money'], ['Frete','freight','money'],
        ['Cupom','coupon','money'], ['ADS','ads','money'], ['Afiliados','affiliates','money'], ['Imposto','tax','money'],
        ['Valor a Receber','received','money'], ['Custo do Produto','cmv','cmv'],
        ['Margem de Contribuição (R$)','contribution','money'], ['Margem de Contribuição (%)','margin','percent']
      ];
      document.getElementById('pricingCompareTable').innerHTML = '<div class="pricing-table-scroll"><table class="pricing-compare-table"><thead><tr><th>Indicador</th>' +
        calculated.map(function (item) { return '<th class="market-' + item.id + '">' + item.label + '</th>'; }).join('') + '</tr></thead><tbody>' +
        indicators.map(function (indicator) {
          return '<tr><th>' + indicator[0] + '</th>' + calculated.map(function (item) {
            var value = indicator[2] === 'cmv' ? cmv : item.result[indicator[1]];
            return '<td class="market-' + item.id + ' ' + (['contribution','margin'].includes(indicator[1]) && value < 0 ? 'negative' : '') + '">' + (indicator[2] === 'percent' ? percent(value) : money(value)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }
    function applyLast(last) {
      document.getElementById('pricingSalePrice').value = last.salePrice;
      document.getElementById('pricingMargin').value = last.desiredMargin;
      var modeInput = document.querySelector('input[name="pricingMode"][value="' + last.calculationMode + '"]');
      if (modeInput) modeInput.checked = true;
      updateModeFields();
      document.querySelectorAll('.pricing-market-check').forEach(function (input) { input.checked = (last.selectedMarketplaces || []).includes(input.value); });
      Object.keys(last.marketplaceSettings || {}).forEach(function (id) { if (settings[id]) settings[id] = Object.assign(settings[id], last.marketplaceSettings[id]); });
      renderConfig();
      recalculate();
    }
    function loadSku(askPrevious) {
      var sku = document.getElementById('pricingSku').value.trim(), info = skuInfo(sku);
      document.getElementById('pricingDescription').value = info.description || '';
      document.getElementById('pricingCmv').value = info.productCost == null ? '' : info.productCost;
      document.getElementById('pricingWeight').value = info.realWeight || 0;
      document.getElementById('pricingHeight').value = info.height || 0;
      document.getElementById('pricingWidth').value = info.width || 0;
      document.getElementById('pricingLength').value = info.length || 0;
      recalculate();
      var previous = database.lastPricing[sku];
      if (askPrevious && previous && window.confirm('Foi encontrada uma precificação anterior. Deseja carregá-la?')) applyLast(previous);
    }

    renderConfig();
    document.querySelectorAll('#pricingForm input').forEach(function (input) {
      if (input.id !== 'pricingSku') input.addEventListener('input', recalculate);
    });
    document.getElementById('pricingSalePrice').addEventListener('input', function () {
      document.querySelector('input[name="pricingMode"][value="price"]').checked = true;
      updateModeFields();
      recalculate();
    });
    document.getElementById('pricingMargin').addEventListener('input', function () {
      document.querySelector('input[name="pricingMode"][value="margin"]').checked = true;
      updateModeFields();
      recalculate();
    });
    document.querySelectorAll('input[name="pricingMode"], .pricing-market-check').forEach(function (input) { input.addEventListener('change', recalculate); });
    document.querySelectorAll('input[name="pricingMode"]').forEach(function (input) {
      input.addEventListener('change', updateModeFields);
    });
    document.getElementById('pricingSku').addEventListener('change', function () { loadSku(true); });
    document.getElementById('pricingForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var status = document.getElementById('pricingSaveStatus');
      status.className = 'pricing-status';
      status.textContent = 'Salvando produto e última precificação...';
      try {
        var sku = document.getElementById('pricingSku').value.trim();
        var user = document.getElementById('pricingUser').value.trim();
        if (!sku || !user || number(document.getElementById('pricingCmv').value) <= 0) throw new Error('Informe SKU, responsável e custo do produto.');
        await saveDatabase({
          action: 'upsert-cost', sku: sku, description: document.getElementById('pricingDescription').value,
          category: ((database.costs || {})[sku] || {}).category || '', productCost: document.getElementById('pricingCmv').value,
          realWeight: document.getElementById('pricingWeight').value, height: document.getElementById('pricingHeight').value,
          width: document.getElementById('pricingWidth').value, length: document.getElementById('pricingLength').value, responsible: user
        });
        await saveDatabase({
          action: 'save-last-pricing', sku: sku, user: user, description: document.getElementById('pricingDescription').value,
          calculationMode: mode(), salePrice: document.getElementById('pricingSalePrice').value,
          desiredMargin: document.getElementById('pricingMargin').value, selectedMarketplaces: selectedIds(), marketplaceSettings: settings
        });
        localStorage.setItem('pricingLastUser', user);
        status.className = 'pricing-status success';
        status.textContent = 'Última precificação salva para este SKU.';
        recalculate();
      } catch (error) {
        status.className = 'pricing-status error';
        status.textContent = error.message;
      }
    });
    updateModeFields();
    recalculate();
  }

  function renderCostRegistration() {
    var pendingImport = [];
    costContainer.innerHTML = '<div class="pricing-page"><section class="pricing-card pricing-hero"><div class="pricing-heading"><strong>Cadastro de Custos por SKU</strong><span>Os mesmos dados também podem ser editados diretamente na calculadora.</span></div><span class="inventory-link" id="costRegisteredCount">' + Object.keys(database.costs || {}).length + ' SKUs cadastrados</span></section>' +
      '<section class="pricing-card pricing-import"><div class="pricing-import-head"><div><strong>Importar cadastro por planilha</strong><span>Use o modelo CSV com as colunas SKU, DESCRIÇÃO, CUSTO, ALTURA, LARGURA, COMPR. e PESO REAL.</span></div><label class="pricing-button primary" for="costCsvFile">Selecionar CSV</label><input id="costCsvFile" type="file" accept=".csv,text/csv" hidden></div>' +
      '<div class="pricing-import-map"><span>DE → PARA</span><b>CUSTO → Custo do produto</b><b>COMPR. → Comprimento (cm)</b><b>PESO REAL (g) → Peso real (kg)</b></div>' +
      '<div id="costImportPreview" class="pricing-import-preview">Selecione o arquivo preenchido para conferir antes de importar.</div><div class="pricing-import-actions"><button class="pricing-button primary" id="costImportButton" type="button" disabled>Importar produtos</button></div><div class="pricing-status" id="costImportStatus"></div></section>' +
      '<section class="pricing-card"><form class="pricing-form" id="pricingCostForm">' +
      '<div class="pricing-field wide"><label>SKU</label><input id="costSku" required list="costSkuList" autocomplete="off" placeholder="Pesquise ou informe o SKU"><datalist id="costSkuList">' + skuOptions() + '</datalist></div>' +
      '<div class="pricing-field wide"><label>Descrição</label><input id="costDescription"></div><div class="pricing-field"><label>Categoria</label><input id="costCategory" list="costCategoryList"><datalist id="costCategoryList">' + (master.categories || []).map(function (category) { return '<option value="' + escapeHtml(category.name || category) + '">'; }).join('') + '</datalist></div>' +
      '<div class="pricing-field"><label>Custo do produto</label><input id="costProduct" required type="number" min="0" step=".01"></div><div class="pricing-field"><label>Peso real (kg)</label><input id="costRealWeight" type="number" min="0" step=".001" value="0"></div>' +
      '<div class="pricing-field"><label>Altura (cm)</label><input id="costHeight" type="number" min="0" step=".01" value="0"></div><div class="pricing-field"><label>Largura (cm)</label><input id="costWidth" type="number" min="0" step=".01" value="0"></div><div class="pricing-field"><label>Comprimento (cm)</label><input id="costLength" type="number" min="0" step=".01" value="0"></div>' +
      '<div class="pricing-field"><label>Peso cubado (kg)</label><input id="costCubedWeight" readonly></div><div class="pricing-field"><label>Peso considerado no frete</label><input id="costConsideredWeight" readonly></div><div class="pricing-field"><label>Responsável</label><input id="costResponsible" required value="' + escapeHtml(localStorage.getItem('pricingLastUser') || '') + '"></div>' +
      '<div class="pricing-actions"><button class="pricing-button primary" type="submit">Salvar cadastro de custo</button></div></form><div class="pricing-status" id="costStatus"></div></section><section class="pricing-card"><div id="costTable"></div></section></div>';
    function dimensions() {
      var cubed = number(document.getElementById('costHeight').value) * number(document.getElementById('costWidth').value) * number(document.getElementById('costLength').value) / 6000;
      document.getElementById('costCubedWeight').value = cubed.toFixed(4);
      document.getElementById('costConsideredWeight').value = Math.max(cubed, number(document.getElementById('costRealWeight').value)).toFixed(4);
    }
    function fill() {
      var info = skuInfo(document.getElementById('costSku').value.trim());
      ['Description','Category','Product','RealWeight','Height','Width','Length'].forEach(function (suffix) {
        var keys = { Description: 'description', Category: 'category', Product: 'productCost', RealWeight: 'realWeight', Height: 'height', Width: 'width', Length: 'length' };
        document.getElementById('cost' + suffix).value = info[keys[suffix]] || '';
      });
      document.getElementById('costResponsible').value = info.responsible || localStorage.getItem('pricingLastUser') || '';
      dimensions();
    }
    function table() {
      var rows = Object.values(database.costs || {});
      document.getElementById('costTable').innerHTML = rows.length ? '<div class="pricing-table-scroll"><table class="pricing-history-table"><thead><tr><th>SKU</th><th>Descrição</th><th>Categoria</th><th>Custo</th><th>Peso frete</th><th>Atualização</th><th>Responsável</th></tr></thead><tbody>' +
        rows.map(function (row) { return '<tr data-cost-sku="' + escapeHtml(row.sku) + '"><td><strong>' + escapeHtml(row.sku) + '</strong></td><td>' + escapeHtml(row.description) + '</td><td>' + escapeHtml(row.category) + '</td><td>' + money(row.productCost) + '</td><td>' + number(row.consideredWeight).toFixed(3) + ' kg</td><td>' + escapeHtml(dateTime(row.updatedAt)) + '</td><td>' + escapeHtml(row.responsible) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="pricing-empty">Nenhum custo cadastrado.</div>';
      document.querySelectorAll('[data-cost-sku]').forEach(function (row) { row.addEventListener('click', function () { document.getElementById('costSku').value = row.dataset.costSku; fill(); }); });
    }
    ['costRealWeight','costHeight','costWidth','costLength'].forEach(function (id) { document.getElementById(id).addEventListener('input', dimensions); });
    document.getElementById('costSku').addEventListener('change', fill);
    document.getElementById('costCsvFile').addEventListener('change', async function (event) {
      var status = document.getElementById('costImportStatus');
      try {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var parsed = parseProductCsv(await file.text());
        pendingImport = parsed.rows;
        document.getElementById('costImportButton').disabled = !pendingImport.length;
        document.getElementById('costImportPreview').innerHTML = '<strong>' + pendingImport.length + ' produtos prontos para importar</strong><span>' +
          parsed.duplicates + ' SKU(s) duplicado(s) consolidado(s). Amostra: ' + pendingImport.slice(0, 3).map(function (row) { return escapeHtml(row.sku); }).join(', ') + '</span>';
        status.className = 'pricing-status';
        status.textContent = 'Arquivo conferido. Clique em Importar produtos.';
      } catch (error) {
        pendingImport = [];
        document.getElementById('costImportButton').disabled = true;
        document.getElementById('costImportPreview').textContent = 'Não foi possível preparar o arquivo.';
        status.className = 'pricing-status error';
        status.textContent = error.message;
      }
    });
    document.getElementById('costImportButton').addEventListener('click', async function () {
      var status = document.getElementById('costImportStatus');
      try {
        if (!pendingImport.length) throw new Error('Selecione um arquivo válido.');
        status.className = 'pricing-status';
        status.textContent = 'Importando ' + pendingImport.length + ' produtos...';
        var result = await postJson('/api/pricing-database', {
          action: 'import-costs',
          rows: pendingImport,
          responsible: document.getElementById('costResponsible').value || localStorage.getItem('pricingLastUser') || 'Importação CSV'
        });
        database = result;
        database.lastPricing = database.lastPricing || {};
        var summary = result.importSummary || {};
        status.className = 'pricing-status success';
        status.textContent = (summary.created || 0) + ' criados e ' + (summary.updated || 0) + ' atualizados.';
        document.getElementById('costRegisteredCount').textContent = Object.keys(database.costs || {}).length + ' SKUs cadastrados';
        document.getElementById('costSkuList').innerHTML = skuOptions();
        table();
      } catch (error) {
        status.className = 'pricing-status error';
        status.textContent = error.message;
      }
    });
    document.getElementById('pricingCostForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var status = document.getElementById('costStatus');
      try {
        await saveDatabase({ action: 'upsert-cost', sku: document.getElementById('costSku').value, description: document.getElementById('costDescription').value, category: document.getElementById('costCategory').value, productCost: document.getElementById('costProduct').value, realWeight: document.getElementById('costRealWeight').value, height: document.getElementById('costHeight').value, width: document.getElementById('costWidth').value, length: document.getElementById('costLength').value, responsible: document.getElementById('costResponsible').value });
        status.className = 'pricing-status success'; status.textContent = 'Cadastro salvo.'; table();
      } catch (error) { status.className = 'pricing-status error'; status.textContent = error.message; }
    });
    table();
  }

  async function updateRule(rule, card) {
    var payload = { action: 'update-rule', id: rule.id, notes: card.querySelector('.pricing-rule-notes').value };
    ['commissionRate','fixedFee','couponRate','adsRate','affiliatesRate','taxRate'].forEach(function (field) { payload[field] = card.querySelector('[data-rule-field="' + field + '"]').value; });
    rulesState = await postJson('/api/pricing-rules', payload);
  }
  function renderRules() {
    rulesContainer.innerHTML = '<div class="pricing-page"><section class="pricing-card pricing-hero"><div class="pricing-heading"><strong>Configurações dos Marketplaces</strong><span>Comissão, cupom, mídia, imposto e frete independentes por plataforma.</span></div></section><div class="pricing-rules-grid">' +
      (rulesState.rules || []).map(function (rule) {
        return '<section class="pricing-card pricing-rule" data-rule="' + escapeHtml(rule.id) + '"><div class="pricing-rule-head"><strong>' + escapeHtml(rule.name) + '</strong><span class="inventory-link">' + escapeHtml(rule.freightMode === 'none' ? 'Sem tabela de frete' : 'Frete automático') + '</span></div><div class="pricing-rule-fields">' +
          [['commissionRate','Comissão (%)'],['fixedFee','Tarifa fixa'],['couponRate','Cupom (%)'],['adsRate','ADS (%)'],['affiliatesRate','Afiliados (%)'],['taxRate','Imposto (%)']].map(function (definition) {
            return '<div class="pricing-field"><label>' + definition[1] + '</label><input data-rule-field="' + definition[0] + '" type="number" min="0" step=".01" value="' + number(rule[definition[0]]) + '"></div>';
          }).join('') + '</div><div class="pricing-field"><label>Regra de frete / observações</label><textarea class="pricing-rule-notes">' + escapeHtml(rule.notes || '') + '</textarea></div><button class="pricing-button primary pricing-rule-save" type="button">Salvar configuração</button><div class="pricing-status"></div></section>';
      }).join('') + '</div></div>';
    rulesContainer.querySelectorAll('.pricing-rule').forEach(function (card) {
      card.querySelector('.pricing-rule-save').addEventListener('click', async function () {
        var status = card.querySelector('.pricing-status');
        try { await updateRule(ruleById(card.dataset.rule), card); status.className = 'pricing-status success'; status.textContent = 'Configuração salva.'; }
        catch (error) { status.className = 'pricing-status error'; status.textContent = error.message; }
      });
    });
  }

  async function openPanel(panelId) {
    var target = panelId === 'pricingCalculatorPanel' ? calculatorContainer : panelId === 'pricingCostPanel' ? costContainer : rulesContainer;
    try {
      await loadData();
      if (panelId === 'pricingCalculatorPanel') renderCalculator();
      else if (panelId === 'pricingCostPanel') renderCostRegistration();
      else renderRules();
    } catch (error) {
      target.innerHTML = '<div class="empty-table">' + escapeHtml(error.message) + '</div>';
    }
  }
  document.querySelectorAll('[data-tab^="pricing"]').forEach(function (button) { button.addEventListener('click', function () { openPanel(button.dataset.tab); }); });
}());
