(function () {
  'use strict';

  var container = document.getElementById('adsUploadContainer');
  if (!container) return;

  container.innerHTML = '<div class="sales-upload-shell">' +
    '<div class="sales-upload-heading"><div><span class="sales-upload-eyebrow">Integração de publicidade</span>' +
    '<h2>Subir Base de ADS Actual</h2><p>A nova carga substitui integralmente o ADS anterior da conta e do mês selecionados, sem alterar as linhas de vendas.</p></div>' +
    '<span class="sales-upload-badge">ADS → Base de Dados</span></div>' +
    '<div class="sales-upload-grid"><div class="sales-upload-card">' +
    '<label class="sales-upload-password">Plataforma<select id="adsUploadPlatform"><option value="Mercado Livre">Mercado Livre</option><option value="Shopee">Shopee</option></select></label>' +
    '<label class="sales-upload-password">Conta / Marketplace venda<select id="adsUploadAccount"><option value="">Carregando contas cadastradas...</option></select></label>' +
    '<label class="sales-upload-password">Mês da Base de Dados<select id="adsUploadMonth"></select></label>' +
    '<label class="sales-upload-password">Senha administrativa<input id="adsUploadPassword" type="password" autocomplete="current-password" placeholder="Informe a senha"></label>' +
    '<label class="sales-upload-drop" for="adsUploadFile"><span class="sales-upload-icon">↑</span><strong>Selecionar arquivo de ADS</strong>' +
    '<small>.xlsx, .xlsm, .xls ou .csv · aba DB no padrão de publicidade</small><input id="adsUploadFile" type="file" accept=".xlsx,.xlsm,.xls,.csv"></label>' +
    '<div class="sales-upload-actions"><button class="sales-upload-primary" id="adsUploadRead" type="button">Ler e conferir arquivo</button>' +
    '<button class="sales-upload-primary" id="adsUploadPublish" type="button" disabled>Adicionar à Base de Dados</button></div></div>' +
    '<div class="sales-upload-card"><h3>Conferência</h3><div id="adsUploadStatus" class="sales-upload-result">Selecione o arquivo para começar.</div></div></div></div>';

  var monthSelect = document.getElementById('adsUploadMonth');
  var platformSelect = document.getElementById('adsUploadPlatform');
  var accountSelect = document.getElementById('adsUploadAccount');
  var fileInput = document.getElementById('adsUploadFile');
  var statusBox = document.getElementById('adsUploadStatus');
  var publishButton = document.getElementById('adsUploadPublish');
  var preview = null;
  var registeredAccounts = [];
  var monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  monthSelect.innerHTML = monthNames.map(function (name, index) { return '<option value="' + (index + 1) + '">' + name + '</option>'; }).join('');
  monthSelect.value = String((typeof dashboardState !== 'undefined' && dashboardState.activeMonth) || new Date().getMonth() + 1);

  function refreshAccountOptions() {
    var platform = platformSelect.value;
    var accounts = registeredAccounts.filter(function (item) { return item.marketplace === platform; });
    accountSelect.innerHTML = '<option value="">Selecione a conta</option>' + accounts.map(function (item) {
      return '<option value="' + escapeHtml(item.account) + '">' + escapeHtml(item.account) + '</option>';
    }).join('');
    if (!accounts.length) accountSelect.innerHTML = '<option value="">Nenhuma conta cadastrada nesta plataforma</option>';
    accountSelect.disabled = !accounts.length;
    preview = null;
    publishButton.disabled = true;
  }

  async function loadRegisteredAccounts() {
    try {
      var response = await fetch('/api/marketplace-accounts', { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as contas cadastradas.');
      var result = await response.json();
      registeredAccounts = Array.isArray(result.accounts) ? result.accounts : [];
      refreshAccountOptions();
    } catch (error) {
      registeredAccounts = [];
      refreshAccountOptions();
      statusBox.textContent = error.message;
    }
  }
  platformSelect.addEventListener('change', refreshAccountOptions);
  accountSelect.addEventListener('change', function () { preview = null; publishButton.disabled = true; });
  loadRegisteredAccounts();

  function clean(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function excelDate(value) {
    if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') {
      var parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return String(parsed.y).padStart(4, '0') + '-' + String(parsed.m).padStart(2, '0') + '-' + String(parsed.d).padStart(2, '0');
    }
    var text = clean(value);
    var br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) return br[3] + '-' + br[2].padStart(2, '0') + '-' + br[1].padStart(2, '0');
    var date = new Date(text);
    return isNaN(date) ? '' : date.toISOString().slice(0, 10);
  }
  function numberValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var text = clean(value).replace(/R\$|\s/g, '');
    if (text.indexOf(',') >= 0 && text.indexOf('.') >= 0) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(',', '.');
    return Number(text) || 0;
  }
  function readWorkbook(file) {
    return file.arrayBuffer().then(function (buffer) {
      var workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      var sheetName = workbook.SheetNames.find(function (name) { return clean(name).toUpperCase() === 'DB'; }) || workbook.SheetNames[0];
      return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    });
  }
  function parseMatrix(matrix) {
    if (!matrix.length) throw new Error('Arquivo vazio.');
    var headers = matrix[0].map(clean);
    var aliases = { marketplace: ['Marketplace'], sale: ['Marketplace venda'], sku: ['SKU'], ad: ['Id anúncio','ID anúncio','Id anuncio'], date: ['Data'], category: ['Categoria'], subcategory: ['Sub Categoria','Subcategoria'], value: ['Valor completo','Valor'] };
    var indexes = {};
    Object.keys(aliases).forEach(function (key) { indexes[key] = headers.findIndex(function (header) { return aliases[key].indexOf(header) >= 0; }); });
    var missing = Object.keys(indexes).filter(function (key) { return indexes[key] < 0; });
    if (missing.length) throw new Error('Colunas não encontradas: ' + missing.join(', ') + '. Use o modelo DB de publicidade.');
    var platform = platformSelect.value;
    var account = accountSelect.value;
    if (!account) throw new Error('Selecione a conta / Marketplace venda cadastrada no sistema.');
    var rows = matrix.slice(1).map(function (row) {
      var category = clean(row[indexes.category]);
      var date = excelDate(row[indexes.date]);
      if (!category || !date || !clean(row[indexes.sku])) return null;
      return {
        marketplace: clean(row[indexes.marketplace]) || platform,
        marketplaceSale: account, sku: clean(row[indexes.sku]), ad: clean(row[indexes.ad]),
        date: date, category: category, subcategory: clean(row[indexes.subcategory]), value: numberValue(row[indexes.value])
      };
    }).filter(Boolean);
    var seenRows = new Set();
    var duplicateRows = 0;
    rows = rows.filter(function (row) {
      var key = [row.marketplace, row.marketplaceSale, row.sku, row.ad, row.date, row.category,
        row.subcategory, Number(row.value) || 0].map(clean).join('\u001f');
      if (seenRows.has(key)) { duplicateRows += 1; return false; }
      seenRows.add(key);
      return true;
    });
    if (!rows.length) throw new Error('Nenhuma linha válida de ADS foi encontrada.');
    var categories = {};
    rows.forEach(function (row) { categories[row.category] = (categories[row.category] || 0) + 1; });
    return { rows: rows, duplicateRows: duplicateRows, categories: categories, minDate: rows.map(function (r) { return r.date; }).sort()[0], maxDate: rows.map(function (r) { return r.date; }).sort().slice(-1)[0] };
  }
  document.getElementById('adsUploadRead').onclick = async function () {
    try {
      var file = fileInput.files[0]; if (!file) throw new Error('Selecione o arquivo de ADS.');
      statusBox.textContent = 'Lendo o arquivo...';
      preview = parseMatrix(await readWorkbook(file));
      statusBox.innerHTML = '<strong>Arquivo conferido</strong><br>' + preview.rows.length.toLocaleString('pt-BR') + ' linhas Actual · ' +
        preview.minDate.split('-').reverse().join('/') + ' a ' + preview.maxDate.split('-').reverse().join('/') + '<br>' +
        Object.entries(preview.categories).map(function (item) { return item[0] + ': ' + item[1].toLocaleString('pt-BR'); }).join(' · ') +
        (preview.duplicateRows ? '<br>' + preview.duplicateRows.toLocaleString('pt-BR') + ' duplicidades idênticas removidas.' : '');
      publishButton.disabled = false;
    } catch (error) { preview = null; publishButton.disabled = true; statusBox.textContent = error.message; }
  };
  publishButton.onclick = async function () {
    try {
      var password = document.getElementById('adsUploadPassword').value;
      if (!password) throw new Error('Informe a senha administrativa.');
      if (!preview) throw new Error('Leia e confira o arquivo primeiro.');
      publishButton.disabled = true; publishButton.textContent = 'Publicando...';
      var response = await fetch('/api/ads-base', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password },
        body: JSON.stringify({ month: monthSelect.value, platform: platformSelect.value, account: accountSelect.value, rows: preview.rows }) });
      var result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível publicar a base de ADS.');
      statusBox.innerHTML = '<strong>Base de ADS publicada</strong><br>' + result.added.toLocaleString('pt-BR') + ' linhas adicionadas · ' + result.replaced.toLocaleString('pt-BR') + ' linhas anteriores substituídas.';
      document.getElementById('adsUploadPassword').value = '';
      setTimeout(function () { window.location.reload(); }, 900);
    } catch (error) { statusBox.textContent = error.message; publishButton.disabled = false; publishButton.textContent = 'Adicionar à Base de Dados'; }
  };
})();
