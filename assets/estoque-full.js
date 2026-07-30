(function () {
  'use strict';

  var container = document.getElementById('inventoryFullPanel');
  if (!container) return;

  var database = { rows: [], capacity: {}, importedAt: null, sourceUpdatedAt: '', sourceFile: '' };
  var inventoryStore = { version: 2, companies: {} };
  var marketplaceAccounts = [];
  var selectedCompany = '';
  var filters = { action: '', size: '', type: '', full: '', query: '' };
  var pages = {};
  var planner = (function () {
    try {
      var saved = JSON.parse(localStorage.getItem('marketplace-full-planner-v1') || '{}');
      return { depthDays: [7, 15, 20, 30].indexOf(Number(saved.depthDays)) >= 0 ? Number(saved.depthDays) : 15, shipments: Math.min(10, Math.max(4, Number(saved.shipments) || 4)) };
    } catch (error) { return { depthDays: 15, shipments: 4 }; }
  })();
  var actionDefs = [
    ['all', 'Total no Full', 'occupied', 'neutral'],
    ['healthy', 'Boa qualidade', 'actionHealthy', 'healthy'],
    ['boost', 'Para impulsionar vendas', 'actionBoost', 'boost'],
    ['activate', 'Para colocar à venda', 'actionActivate', 'activate'],
    ['discard', 'Para evitar descarte', 'actionDiscard', 'discard'],
    ['pending', 'Entrada pendente', 'actionPending', 'pending']
  ];

  function savePlanner() {
    try { localStorage.setItem('marketplace-full-planner-v1', JSON.stringify(planner)); } catch (error) {}
    fetch('/api/ui-state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set', key: 'full-planner', value: planner })
    }).catch(function (error) { console.warn('Falha ao salvar o planejamento:', error.message); });
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
    });
  }

  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var clean = String(value == null ? '' : value).replace(/\s/g, '').replace(/R\$/gi, '');
    if (clean.indexOf(',') >= 0) clean = clean.replace(/\./g, '').replace(',', '.');
    var parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function integer(value) { return Math.round(num(value)).toLocaleString('pt-BR'); }
  function money(value) { return num(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function percent(value) { return num(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; }
  function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function sum(rows, key) { return rows.reduce(function (total, row) { return total + num(row[key]); }, 0); }

  function emptyDatabase(account) { return { account: account || '', rows: [], capacity: {}, importedAt: null, sourceUpdatedAt: '', sourceFile: '' }; }
  function companyNames() {
    var names = marketplaceAccounts.slice();
    Object.keys(inventoryStore.companies || {}).forEach(function (name) { if (names.indexOf(name) < 0) names.push(name); });
    return names.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }
  function companySelect() {
    var names = companyNames();
    if (!names.length) return '<div class="full-company-warning">Cadastre e publique uma conta do Mercado Livre na Base de Vendas para liberar o envio.</div>';
    return '<label class="full-company-label">Empresa do Mercado Livre<select id="fullCompany">' + names.map(function (name) { return '<option value="' + esc(name) + '"' + (name === selectedCompany ? ' selected' : '') + '>' + esc(name) + '</option>'; }).join('') + '</select></label>';
  }
  function selectDatabase(account) {
    selectedCompany = account || '';
    database = inventoryStore.companies && inventoryStore.companies[selectedCompany] || emptyDatabase(selectedCompany);
  }

  function parseWeeks(text) {
    var normalized = normalize(text);
    if (normalized === 'sem estoque') return 0;
    var match = normalized.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function dateBr(date) { return date.toLocaleDateString('pt-BR'); }

  function planShipment(row) {
    var dailySales = Math.ceil(num(row.sales30Units) / 30);
    var stockWithTransit = num(row.available) + num(row.inTransit);
    var target = Math.ceil(dailySales * planner.depthDays);
    var dispatchLeadDays = 7;
    var fullAvailabilityDays = 7;
    var totalLeadDays = dispatchLeadDays + fullAvailabilityDays;
    var planningHorizonDays = 90;
    var safetyDays = 2;
    var safetyStock = Math.ceil(dailySales * safetyDays);
    var reserveStock = Math.max(target, safetyStock);
    var maxStock = Math.ceil(dailySales * 30);
    var effectiveShipments = Math.max(4, planner.shipments);
    var projectedAtFirst = Math.max(0, stockWithTransit - (dailySales * totalLeadDays));
    var coverageDays = dailySales > 0 ? stockWithTransit / dailySales : null;
    var stockProjection = stockWithTransit;
    var previousDay = 0;
    var schedule = [];
    for (var index = 0; index < effectiveShipments; index += 1) {
      var lastDispatchDay = planningHorizonDays - fullAvailabilityDays;
      var dispatchDay = dispatchLeadDays + Math.round(index * (lastDispatchDay - dispatchLeadDays) / (effectiveShipments - 1));
      var availabilityDay = dispatchDay + fullAvailabilityDays;
      var nextAvailabilityDay = index === effectiveShipments - 1 ? planningHorizonDays : totalLeadDays + Math.round((index + 1) * (planningHorizonDays - totalLeadDays) / (effectiveShipments - 1));
      stockProjection -= dailySales * (availabilityDay - previousDay);
      var stockNeededUntilNext = (dailySales * Math.max(0, nextAvailabilityDay - availabilityDay)) + reserveStock;
      var desiredStockAfterArrival = Math.min(maxStock, stockNeededUntilNext);
      var quantity = Math.max(0, Math.ceil(desiredStockAfterArrival - Math.max(0, stockProjection)));
      stockProjection += quantity;
      var dispatchDate = new Date();
      dispatchDate.setDate(dispatchDate.getDate() + dispatchDay);
      var availabilityDate = new Date();
      availabilityDate.setDate(availabilityDate.getDate() + availabilityDay);
      schedule.push({ dispatchDate: dateBr(dispatchDate), availabilityDate: dateBr(availabilityDate), quantity: quantity, dispatchDay: dispatchDay, availabilityDay: availabilityDay });
      previousDay = availabilityDay;
    }
    var plannedTotal = schedule.reduce(function (total, item) { return total + item.quantity; }, 0);
    row._dailySales = dailySales;
    row._target = target;
    row._safetyStock = safetyStock;
    row._reserveStock = reserveStock;
    row._maxStock = maxStock;
    row._effectiveShipments = effectiveShipments;
    row._planningHorizonDays = planningHorizonDays;
    row._projectedAtFirst = projectedAtFirst;
    row._coverageDays = coverageDays;
    row._ruptureBeforeFirst = coverageDays != null && coverageDays < totalLeadDays;
    row._plannedTotal = plannedTotal;
    row._schedule = schedule;
    row._firstShipment = schedule.length ? schedule[0].dispatchDate : '-';
    row._firstAvailability = schedule.length ? schedule[0].availabilityDate : '-';
    row._plannerUrgency = coverageDays == null ? 99999 : coverageDays;
    return row;
  }

  function parseCapacity(text) {
    var value = String(text || '');
    var match = value.match(/:\s*([\d.,]+)%\s*\|\s*([\d.,]+)\s*un\.\s*de\s*([\d.,]+)\s*un/i);
    return match ? { percent: num(match[1]), used: num(match[2]), maximum: num(match[3]) } : null;
  }

  function parseWorkbook(file) {
    return file.arrayBuffer().then(function (buffer) {
      if (typeof XLSX === 'undefined') throw new Error('Leitor de Excel não está disponível.');
      var workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      var sheetName = workbook.SheetNames.find(function (name) { return normalize(name) === 'resumo'; });
      if (!sheetName) throw new Error('A planilha precisa conter a aba Resumo.');
      var matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
      var headerRow = matrix.findIndex(function (row) { return normalize(row[1]) === 'codigo ml' && normalize(row[3]) === 'sku'; });
      if (headerRow < 0) throw new Error('Não encontrei o cabeçalho do Relatório geral de estoque.');
      var rows = matrix.slice(headerRow + 3).filter(function (row) { return String(row[1] || row[3] || '').trim(); }).map(function (row) {
        return {
          codeMl: String(row[1] || '').trim(), universalCode: String(row[2] || '').trim(), sku: String(row[3] || '').trim(),
          listing: String(row[4] || '').trim(), variationGroup: String(row[5] || '').trim(), product: String(row[6] || '').trim(),
          size: String(row[7] || '').trim(), productType: String(row[8] || '').trim(), status: String(row[9] || '').trim(), offersFull: String(row[10] || '').trim(),
          sales30Units: num(row[11]), sales30Revenue: num(row[12]), avgStock30: num(row[13]), stockMetricUnits: num(row[14]),
          pending: num(row[15]), transfer: num(row[16]), returns: num(row[17]), available: num(row[18]), unfit: num(row[19]), tempUnfit: 0,
          lost: num(row[20]), review: num(row[21]), cancelled: num(row[22]), occupied: num(row[23]), actionPending: num(row[24]),
          actionHealthy: num(row[25]), actionBoost: num(row[26]), actionActivate: num(row[27]), actionDiscard: num(row[28]),
          depletionText: String(row[29] || '').trim(), depletionWeeks: parseWeeks(row[29])
        };
      });
      if (!rows.length) throw new Error('A aba Resumo não possui produtos para importar.');
      return {
        rows: rows,
        sourceFile: file.name,
        sourceUpdatedAt: String((matrix[2] && matrix[2][1]) || '').trim(),
        capacity: { smallMedium: parseCapacity(matrix[5] && matrix[5][6]), largeExtra: parseCapacity(matrix[6] && matrix[6][6]) }
      };
    });
  }

  function enriched(row) {
    var weeklySales = num(row.sales30Units) / 4.33;
    row.coverageWeeks = weeklySales > 0 ? num(row.available) / weeklySales : null;
    row.turnover = num(row.avgStock30) > 0 ? num(row.sales30Units) / num(row.avgStock30) : null;
    row.inTransit = num(row.pending) + num(row.transfer);
    row.physicalStock = num(row.available) + num(row.unfit) + num(row.tempUnfit) + num(row.lost) + num(row.review) + num(row.cancelled);
    return row;
  }

  function filteredRows(includeAction) {
    var query = normalize(filters.query);
    return (database.rows || []).map(enriched).filter(function (row) {
      if (includeAction !== false && filters.action && filters.action !== 'all') {
        var definition = actionDefs.find(function (item) { return item[0] === filters.action; });
        if (definition && num(row[definition[2]]) <= 0) return false;
      }
      if (filters.size && row.size !== filters.size) return false;
      if (filters.type && row.productType !== filters.type) return false;
      if (filters.full && normalize(row.offersFull) !== normalize(filters.full)) return false;
      if (query && normalize([row.sku, row.product, row.codeMl, row.listing].join(' ')).indexOf(query) < 0) return false;
      return true;
    });
  }

  function unique(rows, key) {
    return Array.from(new Set(rows.map(function (row) { return row[key]; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function options(values, selected, placeholder) {
    return '<option value="">' + esc(placeholder) + '</option>' + values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>';
    }).join('');
  }

  function table(key, title, subtitle, rows, columns, badge) {
    var perPage = 10;
    var totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    pages[key] = Math.min(Math.max(1, pages[key] || 1), totalPages);
    var start = (pages[key] - 1) * perPage;
    var visible = rows.slice(start, start + perPage);
    return '<section class="full-card"><div class="full-section-head"><div><h3>' + esc(title) + '</h3><p>' + esc(subtitle) + '</p></div>' +
      (badge ? '<span class="full-alert ' + esc(badge.type) + '">' + esc(badge.text) + '</span>' : '<span class="full-count">' + integer(rows.length) + ' produtos</span>') + '</div>' +
      '<div class="full-table-wrap"><table class="full-table"><thead><tr>' + columns.map(function (column) { return '<th>' + esc(column.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (visible.length ? visible.map(function (row) { return '<tr>' + columns.map(function (column) {
        var value = column.render ? column.render(row) : esc(row[column.key]);
        return '<td class="' + esc(column.className || '') + '">' + value + '</td>';
      }).join('') + '</tr>'; }).join('') : '<tr><td class="full-empty" colspan="' + columns.length + '">Nenhum produto neste recorte.</td></tr>') +
      '</tbody></table></div><div class="full-pagination"><span>' + integer(rows.length) + ' resultados</span><div><button data-page-key="' + key + '" data-page="' + (pages[key] - 1) + '"' + (pages[key] <= 1 ? ' disabled' : '') + '>Anterior</button><span>' + pages[key] + ' / ' + totalPages + '</span><button data-page-key="' + key + '" data-page="' + (pages[key] + 1) + '"' + (pages[key] >= totalPages ? ' disabled' : '') + '>Próxima</button></div></div></section>';
  }

  function render() {
    var allRows = (database.rows || []).map(enriched);
    if (!allRows.length) return renderEmpty();
    var rows = filteredRows(true);
    var summaryRows = filteredRows(false);
    var total = sum(summaryRows, 'occupied');
    var rupture = rows.filter(function (row) { return row.depletionWeeks != null && row.depletionWeeks >= 1 && row.depletionWeeks <= 3 && row.available > 0 && row.sales30Units > 0; })
      .sort(function (a, b) { return a.depletionWeeks - b.depletionWeeks || b.sales30Units - a.sales30Units; });
    var noTurn = rows.filter(function (row) { return row.actionBoost > 0 && row.sales30Units === 0; }).sort(function (a, b) { return b.occupied - a.occupied; });
    var excess = rows.filter(function (row) { return row.actionBoost > 0 && row.sales30Units > 0 && row.coverageWeeks > 12; }).sort(function (a, b) { return b.coverageWeeks - a.coverageWeeks; });
    var discard = rows.filter(function (row) { return row.actionDiscard > 0; }).sort(function (a, b) { return b.actionDiscard - a.actionDiscard; });
    var fullSales = allRows.filter(function (row) { return normalize(row.offersFull) === 'sim'; }).map(function (row) { return row.sales30Units; }).sort(function (a, b) { return a - b; });
    var median = fullSales.length ? fullSales[Math.floor(fullSales.length / 2)] : 0;
    var outside = rows.filter(function (row) { return normalize(row.offersFull) === 'nao' && row.sales30Units > median; }).sort(function (a, b) { return b.sales30Units - a.sales30Units; });
    var paused = rows.filter(function (row) { return row.actionActivate > 0; }).sort(function (a, b) { return b.actionActivate - a.actionActivate; });
    var inactive = rows.filter(function (row) { return normalize(row.status) === 'inativo' && row.physicalStock > 0; }).sort(function (a, b) { return b.physicalStock - a.physicalStock; });
    var concentration = rows.slice().filter(function (row) { return row.occupied > 0; }).sort(function (a, b) { return b.occupied - a.occupied; }).slice(0, 10);
    var immediate = rupture.filter(function (row) { return row.depletionWeeks <= 2 && row.inTransit === 0; }).length;
    var shipmentPlan = rows.filter(function (row) { return normalize(row.offersFull) === 'sim' && row.sales30Units > 0; }).map(planShipment)
      .sort(function (a, b) { return a._plannerUrgency - b._plannerUrgency || b.sales30Units - a.sales30Units; });

    var cards = actionDefs.map(function (definition) {
      var value = definition[0] === 'all' ? total : sum(summaryRows, definition[2]);
      var ratio = total > 0 ? value / total * 100 : 0;
      return '<button class="full-kpi ' + definition[3] + (filters.action === definition[0] ? ' active' : '') + '" data-action="' + definition[0] + '"><span>' + esc(definition[1]) + '</span><strong>' + integer(value) + ' un.</strong><small>' + percent(ratio) + ' do total</small></button>';
    }).join('');
    var capacities = [['Pequenos e médios', database.capacity.smallMedium], ['Grandes e extragrandes', database.capacity.largeExtra]].filter(function (item) { return item[1]; }).map(function (item) {
      return '<div class="full-capacity"><span>' + esc(item[0]) + '</span><strong>' + percent(item[1].percent) + '</strong><small>' + integer(item[1].used) + ' un. de ' + integer(item[1].maximum) + ' un.</small><i><b style="width:' + Math.min(100, item[1].percent) + '%"></b></i></div>';
    }).join('');
    var baseCols = [
      { label: 'Produto', render: function (row) { return '<strong>' + esc(row.product) + '</strong><small>' + esc(row.codeMl) + '</small>'; } },
      { label: 'SKU', key: 'sku' }, { label: 'Vendas 30d', render: function (row) { return integer(row.sales30Units); }, className: 'number' },
      { label: 'Estoque médio', render: function (row) { return integer(row.avgStock30); }, className: 'number' },
      { label: 'Aptas Full', render: function (row) { return integer(row.available); }, className: 'number' },
      { label: 'A caminho', render: function (row) { return integer(row.inTransit); }, className: 'number' },
      { label: 'Esgota em', render: function (row) { return '<span class="full-risk ' + (row.depletionWeeks <= 2 ? 'danger' : 'warning') + '">' + esc(row.depletionText || '-') + '</span>' + (row.depletionWeeks <= 2 && row.inTransit === 0 ? '<small class="urgent-note">Sem reposição</small>' : ''); } }
    ];
    var stockCols = [baseCols[0], baseCols[1], { label: 'Vendas 30d', render: function (row) { return integer(row.sales30Units); }, className: 'number' }, { label: 'Ocupa espaço', render: function (row) { return integer(row.occupied); }, className: 'number' }, { label: 'Cobertura', render: function (row) { return row.coverageWeeks == null ? 'Sem giro' : row.coverageWeeks.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' sem.'; }, className: 'number' }];
    var discardCols = [baseCols[0], baseCols[1], { label: 'Unidades em risco', render: function (row) { return integer(row.actionDiscard); }, className: 'number' }, { label: 'Não aptas / ocorrências', render: function (row) { return integer(row.unfit + row.tempUnfit + row.lost + row.review); }, className: 'number' }, { label: 'Vendas 30d', render: function (row) { return integer(row.sales30Units); }, className: 'number' }, { label: 'Ação', render: function (row) { return row.unfit + row.tempUnfit + row.lost + row.review > 0 ? 'Retirar / revisar' : 'Promover / descontinuar'; } }];
    var opportunityCols = [baseCols[0], baseCols[1], { label: 'Diagnóstico', render: function (row) { return esc(row._insight || ''); } }, { label: 'Unidades', render: function (row) { return integer(row._units == null ? row.occupied : row._units); }, className: 'number' }];
    var plannerCols = [baseCols[0], baseCols[1],
      { label: 'Venda média/dia', render: function (row) { return integer(row._dailySales); }, className: 'number' },
      { label: 'Aptas + a caminho', render: function (row) { return integer(row.available + row.inTransit); }, className: 'number' },
      { label: 'Projetado em 14 dias', render: function (row) { return '<strong>' + integer(row._projectedAtFirst) + ' un.</strong>' + (row._ruptureBeforeFirst ? '<small class="urgent-note">Pode acabar antes de ficar disponível</small>' : ''); }, className: 'number' },
      { label: 'Estoque-reserva', render: function (row) { return '<strong>' + integer(row._reserveStock) + ' un.</strong><small>Máximo: ' + integer(row._maxStock) + ' un. · 30 dias</small>'; }, className: 'number' },
      { label: '1º envio sugerido', render: function (row) { return '<strong>' + esc(row._firstShipment) + '</strong><small>Disponível em ' + esc(row._firstAvailability) + '</small>'; } },
      { label: 'Total planejado', render: function (row) { return integer(row._plannedTotal); }, className: 'number' },
      { label: 'Datas e quantidades', render: function (row) { return row._schedule.map(function (item, index) { return '<span class="full-schedule-item"><b>' + (index + 1) + 'º</b> Enviar ' + esc(item.dispatchDate) + ' · disponível ' + esc(item.availabilityDate) + ' · ' + integer(item.quantity) + ' un.</span>'; }).join(''); } }
    ];
    var opportunities = outside.map(function (row) { return Object.assign({}, row, { _insight: 'Vende acima da mediana e não oferece Full', _units: row.sales30Units }); })
      .concat(paused.map(function (row) { return Object.assign({}, row, { _insight: 'Colocar anúncio à venda', _units: row.actionActivate }); }))
      .concat(inactive.map(function (row) { return Object.assign({}, row, { _insight: 'Anúncio inativo com estoque remanescente', _units: row.physicalStock }); }))
      .concat(concentration.map(function (row) { return Object.assign({}, row, { _insight: 'Top 10 em ocupação de espaço', _units: row.occupied }); }));

    container.innerHTML = '<div class="full-page"><section class="full-hero"><div><span class="full-eyebrow">Mercado Livre · Full</span><h2>Estoque Full</h2><p>Antecipe rupturas, excesso, estoque parado e risco de descarte.</p></div><div class="full-import">' + companySelect() + '<span>' + esc(database.sourceUpdatedAt || ('Atualizado em ' + new Date(database.importedAt).toLocaleString('pt-BR'))) + '</span><label>Atualizar relatório<input id="fullStockFile" type="file" accept=".xlsx,.xls"></label></div></section>' +
      '<section class="full-kpis">' + cards + '</section>' + (capacities ? '<section class="full-capacities">' + capacities + '</section>' : '<div class="full-pending">Capacidade máxima por porte não informada no relatório.</div>') +
      '<section class="full-filters"><input id="fullSearch" value="' + esc(filters.query) + '" placeholder="Buscar SKU, produto, Código ML ou anúncio"><select id="fullSize">' + options(unique(allRows, 'size'), filters.size, 'Todos os tamanhos') + '</select><select id="fullType">' + options(unique(allRows, 'productType'), filters.type, 'Todos os tipos') + '</select><select id="fullOffer">' + options(['Sim', 'Não'], filters.full, 'Oferece Full: todos') + '</select><button id="fullClear">Limpar filtros</button></section>' +
      '<section class="full-planner-controls"><div><span class="full-eyebrow">Simulador de reposição · horizonte de 90 dias</span><h3>Planejamento de envio ao Full</h3><p>O primeiro envio ocorre em 7 dias e fica disponível em 14. Nenhuma entrada poderá elevar o estoque acima de 30 dias de venda; por isso, o planejamento de 90 dias exige no mínimo 4 remessas.</p></div><label>Profundidade desejada<select id="fullDepth"><option value="7"' + (planner.depthDays === 7 ? ' selected' : '') + '>7 dias</option><option value="15"' + (planner.depthDays === 15 ? ' selected' : '') + '>15 dias</option><option value="20"' + (planner.depthDays === 20 ? ' selected' : '') + '>20 dias</option><option value="30"' + (planner.depthDays === 30 ? ' selected' : '') + '>30 dias</option></select></label><label>Envios em 90 dias<select id="fullShipments">' + Array.from({ length: 10 }, function (_, index) { var value = index + 1; return '<option value="' + value + '"' + (value < 4 ? ' disabled' : '') + (planner.shipments === value ? ' selected' : '') + '>' + value + (value < 4 ? ' · mínimo 4' : (value === 1 ? ' envio' : ' envios')) + '</option>'; }).join('') + '</select></label></section>' +
      '<div class="full-grid">' + table('planner', 'Plano de abastecimento · próximos 90 dias', 'Cada entrada é limitada a 30 dias de venda e cobre o consumo até a próxima remessa, evitando excesso e novas rupturas após o primeiro recebimento.', shipmentPlan, plannerCols, { type: 'pending', text: 'Máximo 30 dias · ' + planner.shipments + ' envios' }) +
      table('rupture', 'Vai acabar', 'Produtos vendendo com até 3 semanas de cobertura.', rupture, baseCols, immediate ? { type: 'danger', text: immediate + ' sem reposição a caminho' } : null) +
      table('noturn', 'Estoque parado · Sem giro', 'Produtos para impulsionar com zero vendas nos últimos 30 dias.', noTurn, stockCols) +
      table('excess', 'Excesso de estoque', 'Produtos vendendo, mas com cobertura superior a 12 semanas.', excess, stockCols) +
      table('discard', 'Risco de descarte', 'Prioridade máxima: unidades sujeitas a custo e descarte no Full.', discard, discardCols, { type: 'danger', text: integer(sum(discard, 'actionDiscard')) + ' unidades em risco' }) +
      table('opportunities', 'Oportunidades', 'Aderir ao Full, reativar anúncios, corrigir estoque órfão e concentração de espaço.', opportunities, opportunityCols) + '</div></div>';
    bind();
  }

  function renderEmpty(message, type) {
    container.innerHTML = '<div class="full-page"><section class="full-hero"><div><span class="full-eyebrow">Mercado Livre · Full</span><h2>Estoque Full</h2><p>Importe o Relatório geral de estoque do Mercado Livre para montar o dashboard.</p></div><div class="full-import">' + companySelect() + '</div></section><section class="full-empty-state ' + esc(type || '') + '"><span>FULL</span><h3>' + esc(message || (selectedCompany ? 'Nenhum relatório importado para ' + selectedCompany : 'Nenhum relatório importado')) + '</h3><p>O sistema utiliza a aba Resumo e substitui apenas os dados da empresa selecionada.</p>' + (selectedCompany ? '<label>Selecionar relatório Excel<input id="fullStockFile" type="file" accept=".xlsx,.xls"></label>' : '') + '</section></div>';
    bind();
  }

  function bind() {
    var company = document.getElementById('fullCompany');
    if (company) company.addEventListener('change', function () { selectDatabase(this.value); filters = { action: '', size: '', type: '', full: '', query: '' }; pages = {}; render(); });
    var fileInput = document.getElementById('fullStockFile');
    if (fileInput) fileInput.addEventListener('change', async function () {
      if (!this.files || !this.files[0]) return;
      renderEmpty('Lendo e conferindo o relatório...', 'loading');
      try {
        var parsed = await parseWorkbook(this.files[0]);
        if (!selectedCompany) throw new Error('Selecione a empresa do Mercado Livre.');
        var response = await fetch('/api/inventory-full', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'replace', account: selectedCompany }, parsed)) });
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o relatório.');
        inventoryStore = result;
        selectDatabase(selectedCompany);
        filters = { action: '', size: '', type: '', full: '', query: '' };
        pages = {};
        render();
      } catch (error) { renderEmpty(error.message || 'Arquivo inválido.', 'error'); }
    });
    container.querySelectorAll('[data-action]').forEach(function (button) { button.addEventListener('click', function () { filters.action = this.dataset.action; pages = {}; render(); }); });
    var search = document.getElementById('fullSearch');
    if (search) {
      search.addEventListener('change', function () { filters.query = this.value; pages = {}; render(); });
      search.addEventListener('keydown', function (event) { if (event.key === 'Enter') { filters.query = this.value; pages = {}; render(); } });
    }
    [['fullSize', 'size'], ['fullType', 'type'], ['fullOffer', 'full']].forEach(function (pair) { var field = document.getElementById(pair[0]); if (field) field.addEventListener('change', function () { filters[pair[1]] = this.value; pages = {}; render(); }); });
    var clear = document.getElementById('fullClear');
    if (clear) clear.addEventListener('click', function () { filters = { action: '', size: '', type: '', full: '', query: '' }; pages = {}; render(); });
    container.querySelectorAll('[data-page-key]').forEach(function (button) { button.addEventListener('click', function () { pages[this.dataset.pageKey] = Number(this.dataset.page); render(); }); });
    [['fullDepth', 'depthDays'], ['fullShipments', 'shipments']].forEach(function (pair) {
      var field = document.getElementById(pair[0]);
      if (field) field.addEventListener('change', function () {
        planner[pair[1]] = Number(this.value);
        savePlanner();
        pages.planner = 1;
        render();
      });
    });
  }

  async function load() {
    try {
      var responses = await Promise.all([fetch('/api/inventory-full', { cache: 'no-store' }), fetch('/api/marketplace-accounts', { cache: 'no-store' }), fetch('/api/ui-state?key=full-planner', { cache: 'no-store' })]);
      if (!responses[0].ok || !responses[1].ok) throw new Error('Não foi possível carregar o Estoque Full.');
      inventoryStore = await responses[0].json();
      var accountsPayload = await responses[1].json();
      if (responses[2].ok) {
        var plannerPayload = await responses[2].json();
        if (plannerPayload.value) {
          planner.depthDays = [7, 15, 20, 30].indexOf(Number(plannerPayload.value.depthDays)) >= 0 ? Number(plannerPayload.value.depthDays) : planner.depthDays;
          planner.shipments = Math.min(10, Math.max(4, Number(plannerPayload.value.shipments) || planner.shipments));
        } else savePlanner();
      }
      marketplaceAccounts = (accountsPayload.accounts || []).filter(function (item) { return normalize(item.marketplace) === 'mercado livre'; }).map(function (item) { return String(item.account || '').trim(); }).filter(Boolean);
      var names = companyNames();
      if (!selectedCompany || names.indexOf(selectedCompany) < 0) selectedCompany = names[0] || '';
      selectDatabase(selectedCompany);
      render();
    } catch (error) { renderEmpty(error.message, 'error'); }
  }

  document.querySelectorAll('[data-tab="inventoryFullPanel"]').forEach(function (button) { button.addEventListener('click', load); });
})();
