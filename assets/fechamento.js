(function () {
  'use strict';

  var months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  var reference = {
    receipts: Array(12).fill(0), products: Array(12).fill(0), salesCost: Array(12).fill(0),
    contribution: Array(12).fill(0), fixed: Array(12).fill(0), operating: Array(12).fill(0),
    variable: Array(12).fill(0), cash: Array(12).fill(0), paid: Array(12).fill(0)
  };
  var dre = {
    revenue: Array(12).fill(0), cmv: Array(12).fill(0), tax: Array(12).fill(0),
    mkp: Array(12).fill(0), contribution: Array(12).fill(0), fixed: Array(12).fill(0),
    operating: Array(12).fill(0), variable: Array(12).fill(0), result: Array(12).fill(0)
  };
  var mappings = [
    ['Cashback', 'Receitas', 1], ['Juros Passivos', 'Receitas', 1], ['Outras receitas', 'Receitas', 1],
    ['Recebimentos', 'Receitas', 1], ['Rendimentos Bancários', 'Receitas', 1], ['Resgates', 'Receitas', 1],
    ['Vendas', 'Receitas', 1], ['Rendimentos', 'Juros Sobre Investimento', 2],
    ['Fornecedor de Mercadoria', 'Produtos', 3], ['Insumos de Fabricação', 'Produtos', 3],
    ['Embalagens', 'Embalagem', 4], ['DAS', 'Imposto sobre Mercadoria Vendida', 5],
    ['Salários', 'Despesas com pessoal', 6], ['Refeições', 'Despesas com pessoal', 6],
    ['Pró-Labore', 'Pró-labore', 7], ['Limpeza', 'Manutenção Operacional', 8],
    ['Aluguéis e condomínio', 'Aluguel', 9], ['Contabilidade', 'Serviços', 10],
    ['ADS Mercado Livre', 'Despesas com ADS', 11], ['Frete - FULL', 'Despesas com FULL', 12],
    ['Frete', 'Despesas Comerciais', 13], ['Manutenção Predial', 'Manutenção', 14],
    ['Tiny', 'Gastos com Sistema', 15], ['Combustível', 'Gastos com veículos', 16],
    ['Tarifas Bancárias', 'Despesas Financeiras', 17], ['Empréstimo Bancário', 'Amortização (Empréstimos)', 18],
    ['Investimentos', 'Investimentos', 19], ['Projetos Patas Fiéis', 'Projetos Patas Fiéis', 20],
    ['Parcelamento de DAS', 'Parcelamentos', 21], ['Transferência', 'Transferência', 99]
  ];
  var cashFlowState = {
    records: [],
    preview: null,
    fileName: '',
    importedAt: ''
  };
  var budgetState = {
    rows: {},
    details: [],
    months: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
    sourceSheet: ''
  };
  var dreStructure = [];
  var salesDre = { year: 2026, sourceSheet: '', months: {} };
  var cashHoverDetails = {};

  async function refreshSalesRevenueFromDashboardUploads() {
    if (typeof loadPublishedMetadata !== 'function' || typeof loadSalesHistoryRowsByMonth !== 'function') return;
    try {
      await loadPublishedMetadata();
      await loadSalesHistoryRowsByMonth();
      var cache = dashboardState.salesHistoryRowsByMonth || {};
      var metadata = dashboardState.monthMetadata || {};
      var refreshedMonths = {};

      Object.keys(metadata).forEach(function (monthKey) {
        if (!metadata[monthKey] || !metadata[monthKey].exists) return;
        var dataset = cache[monthKey];
        var revenue = 0;
        var cmv = 0;
        var tax = 0;
        var mkp = 0;
        var importedGrossMargin = 0;
        var importedGrossMarginRows = 0;
        if (dataset && Array.isArray(dataset.dataRows)) {
          dataset.dataRows.forEach(function (row) {
            var category = getSalesHistoryCell(row, dataset.columns.category);
            var scenario = getSalesHistoryCell(row, dataset.columns.scenario);
            var ad = getSalesHistoryCell(row, dataset.columns.ad);
            var categoryKey = normalizeText(category);
            var amount = parseNumber(row[dataset.columns.amount]) || 0;
            if (dataset.columns.scenario >= 0 && !isActualDatatype(scenario)) return;
            if (normalizeText(ad) === 'xx') return;

            if (categoryKey === normalizeText('13.Faturamento Bruto')) {
              revenue += amount;
              return;
            }
            if (categoryKey === normalizeText('02.Imposto')) {
              tax += amount;
              return;
            }
            if (categoryKey === normalizeText('03.Despesas Marketplace')) {
              mkp += amount;
              return;
            }
            if (categoryKey === normalizeText('GM') ||
                categoryKey === normalizeText('Gross margen') ||
                categoryKey === normalizeText('Gross margin')) {
              importedGrossMargin += amount;
              importedGrossMarginRows += 1;
              return;
            }

            var categoryNumberMatch = String(category || '').trim().match(/^(\d{1,2})\s*\./);
            var categoryNumber = categoryNumberMatch ? Number(categoryNumberMatch[1]) : 0;
            if (categoryKey === normalizeText('CMV') ||
                (categoryNumber >= 4 && categoryNumber <= 13 &&
                 categoryKey !== normalizeText('13.Faturamento Bruto'))) {
              cmv += amount;
            }
          });
        }
        var previous = salesDre.months && salesDre.months[monthKey] ? salesDre.months[monthKey] : {};
        var calculatedGrossMargin = revenue + cmv + tax + mkp;
        refreshedMonths[monthKey] = Object.assign({}, previous, {
          revenue: revenue,
          cmv: cmv,
          tax: tax,
          mkp: mkp,
          contribution: importedGrossMarginRows ? importedGrossMargin : calculatedGrossMargin
        });
      });

      salesDre = {
        year: new Date().getFullYear(),
        sourceSheet: 'Bases publicadas no dashboard',
        months: refreshedMonths
      };
    } catch (error) {
      console.warn('Não foi possível atualizar o faturamento pelas bases do dashboard:', error.message);
    }
  }

  function loadClosingState() {
    try {
      var saved = JSON.parse(localStorage.getItem('marketplace-financial-closing') || '{}');
      if (Array.isArray(saved.records)) cashFlowState.records = saved.records;
      if (saved.fileName) cashFlowState.fileName = saved.fileName;
      if (saved.importedAt) cashFlowState.importedAt = saved.importedAt;
      if (saved.budget && saved.budget.rows) budgetState = saved.budget;
      return Array.isArray(saved.records) && saved.records.length > 0;
    } catch (error) {
      console.warn('Não foi possível restaurar o fechamento salvo:', error.message);
      return false;
    }
  }

  async function loadFinancialSeed(preserveRecords) {
    try {
      var response = await fetch('/assets/fechamento-seed.json?v=1', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var seed = await response.json();
      if (!preserveRecords) {
        cashFlowState.records = Array.isArray(seed.records) ? seed.records : [];
        cashFlowState.fileName = seed.sourceFile || '';
        cashFlowState.importedAt = seed.generatedAt || '';
      }
      if (seed.budget) {
        budgetState = {
          rows: {},
          details: Array.isArray(seed.budget.rows) ? seed.budget.rows : [],
          comparisonRows: Array.isArray(seed.budget.comparisonRows) ? seed.budget.comparisonRows : [],
          months: seed.budget.months || budgetState.months,
          sourceSheet: seed.budget.sourceSheet || ''
        };
      }
      dreStructure = Array.isArray(seed.dreStructure) ? seed.dreStructure : [];
      salesDre = seed.salesDre && seed.salesDre.months ? seed.salesDre : salesDre;
      saveClosingState();
    } catch (error) {
      console.warn('Não foi possível carregar o fechamento inicial:', error.message);
    }
  }

  function saveClosingState() {
    try {
      localStorage.setItem('marketplace-financial-closing', JSON.stringify({
        records: cashFlowState.records,
        fileName: cashFlowState.fileName,
        importedAt: cashFlowState.importedAt,
        budget: budgetState
      }));
    } catch (error) {
      console.warn('O navegador não conseguiu persistir todo o fechamento:', error.message);
    }
  }

  function money(value) {
    if (!value) return '–';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  function numberClass(value) {
    return value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted';
  }

  function sum(values) {
    return values.reduce(function (total, value) { return total + value; }, 0);
  }

  function head(title, subtitle, actions) {
    return '<div class="closing-toolbar"><div class="closing-title"><h2>' + title + '</h2><p>' + subtitle +
      '</p></div><div class="closing-actions">' + (actions || yearControl()) + '</div></div>';
  }

  function yearControl() {
    return '<label>Ano <select class="closing-select" aria-label="Ano do fechamento"><option>2026</option><option>2025</option><option>2024</option></select></label>';
  }

  function kpis(items) {
    return '<div class="closing-kpis">' + items.map(function (item) {
      return '<article class="closing-kpi"><span>' + item[0] + '</span><strong class="' + numberClass(item[1]) + '">' + money(item[1]) + '</strong></article>';
    }).join('') + '</div>';
  }

  function numericButton(label, month, value, source) {
    return '<button class="closing-value ' + numberClass(value) + '" type="button" data-closing-value="' +
      encodeURIComponent(label) + '" data-month="' + month + '" data-value="' + value + '" data-source="' + source + '">' + money(value) + '</button>';
  }

  function monthlyTable(rows, source) {
    var header = '<tr><th>Classificação</th>' + months.map(function (month) { return '<th>' + month + '</th>'; }).join('') + '<th>TOTAL</th></tr>';
    var body = rows.map(function (row) {
      var values = row.values;
      return '<tr class="' + (row.kind || '') + '"><td>' + (row.expandable ? '<b>＋</b> ' : '') + row.label + '</td>' +
        values.map(function (value, index) { return '<td>' + numericButton(row.label, index + 1, value, source) + '</td>'; }).join('') +
        '<td>' + numericButton(row.label, 13, sum(values), source) + '</td></tr>';
    }).join('');
    return '<div class="closing-card"><div class="closing-card-head"><h3>Visão mensal</h3><span class="closing-pill">JAN–DEZ + TOTAL</span></div><div class="closing-table-wrap"><table class="closing-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function emptyCashFlowTable() {
    return '<div class="closing-card"><div class="closing-card-head"><h3>Lançamentos</h3><span class="closing-pill">0 lançamentos</span></div>' +
      '<div class="closing-import"><strong>Nenhum fluxo de caixa importado.</strong><br>Envie um arquivo Excel ou CSV com as colunas ANO, Mês, Data, Cliente/Fornecedor, Histórico, Categoria, Classificação, Conta, Valor e Tipo.</div></div>';
  }

  function cashFlowTable(records) {
    var visible = records.slice().sort(function (a, b) { return (a.line || 0) - (b.line || 0); }).slice(0, 300);
    return '<div class="closing-card"><div class="closing-card-head"><h3>Lançamentos</h3><span class="closing-pill">' +
      records.length.toLocaleString('pt-BR') + ' lançamentos' + (records.length > visible.length ? ' · primeiros 300 exibidos' : '') +
      ' · ordem original do Excel</span></div><div class="closing-table-wrap"><table class="closing-table"><thead><tr><th>ANO</th><th>Mês</th><th>Data</th><th>Cliente / Fornecedor</th><th>Histórico</th><th>Categoria</th><th>Classificação</th><th>Conta</th><th>Valor</th><th>Tipo</th></tr></thead><tbody>' +
      visible.map(function (record) {
        return '<tr><td>' + escapeCashHtml(record.year) + '</td><td>' + escapeCashHtml(months[record.month - 1] || '') +
          '</td><td>' + escapeCashHtml(record.dateLabel) + '</td><td>' + escapeCashHtml(record.client) + '</td><td>' +
          escapeCashHtml(record.history) + '</td><td>' + escapeCashHtml(record.category) + '</td><td>' +
          escapeCashHtml(record.classification) + '</td><td>' + escapeCashHtml(record.account) +
          '</td><td class="' + numberClass(record.value) + '">' + money(record.value) + '</td><td><span class="closing-status ' +
          (record.type === 'C' ? 'good' : 'bad') + '">' + record.type + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function renderCashFlow() {
    var container = document.getElementById('cashFlowContainer');
    if (!container) return;
    var records = cashFlowState.records;
    var entries = records.filter(function (record) { return record.value > 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var exits = records.filter(function (record) { return record.value < 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var balance = entries + exits;
    var years = getCashSummaryYears();
    var hierarchyYear = years[0] || 2026;
    var hierarchyRecords = records.filter(function (record) { return record.year === hierarchyYear; });
    var activeMonths = Array.from(new Set(hierarchyRecords.map(function (record) { return record.month; }).filter(Boolean))).sort(function (a, b) { return a - b; });
    var hierarchy = hierarchyRecords.length ? '<div class="closing-card"><div class="closing-card-head"><h3>Fluxo organizado por classificação</h3><span class="closing-pill">' +
      hierarchyYear + ' · classificação → categoria → lançamento</span></div><div class="closing-table-wrap"><table class="closing-table cash-hierarchy-table"><thead><tr><th>Classificação / Categoria / Lançamento</th>' +
      activeMonths.map(function (month) { return '<th>' + months[month - 1] + '</th>'; }).join('') +
      '<th>TOTAL</th></tr></thead><tbody>' + buildCashSummaryHierarchy(hierarchyRecords, activeMonths) + '</tbody></table></div></div>' : '';
    container.innerHTML = '<div class="closing-shell">' +
      head('Base — Fluxo de Caixa', 'Importação, validação e consulta dos lançamentos financeiros.',
        '<label class="closing-button primary" for="cashFlowFileInput">Importar fluxo de caixa</label><input class="closing-input" id="cashFlowFileInput" type="file" accept=".xlsx,.xls,.csv" aria-label="Selecionar arquivo do fluxo de caixa">') +
      kpis([['Entradas do período', entries], ['Saídas do período', exits], ['Saldo do período', balance], ['Saldo acumulado', balance]]) +
      '<div id="cashImportPreview"></div>' +
      hierarchy + (records.length ? cashFlowTable(records) : emptyCashFlowTable()) + '</div>';
    var fileInput = document.getElementById('cashFlowFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', handleCashFlowFile);
    }
    bindCashExpandButtons(container);
  }

  function escapeCashHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function normalizeCashText(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeCashKey(value) {
    return normalizeCashText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function parseCashValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var text = normalizeCashText(value);
    if (!text) return null;
    var negative = /^\(.*\)$/.test(text) || /^-/.test(text);
    text = text.replace(/[R$\s()]/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    var parsed = Number(text);
    if (!Number.isFinite(parsed)) return null;
    return negative ? -Math.abs(parsed) : parsed;
  }

  function parseCashDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      var serialDate = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return Number.isNaN(serialDate.getTime()) ? null : serialDate;
    }
    var text = normalizeCashText(value);
    var match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (!match) return null;
    var year = Number(match[3]);
    if (year < 100) year += 2000;
    var date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseCashMonth(value) {
    var key = normalizeCashKey(value);
    var names = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    var number = Number(key);
    if (Number.isInteger(number) && number >= 1 && number <= 12) return number;
    var index = names.findIndex(function (name) { return name === key || name.slice(0, 3) === key.slice(0, 3); });
    return index >= 0 ? index + 1 : 0;
  }

  function cashDateLabel(date) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
  }

  function cashDateIso(date) {
    return date.toISOString().slice(0, 10);
  }

  function findCashHeaderRow(rows) {
    var required = ['ANO', 'MES', 'DATA', 'CATEGORIA', 'CLASSIFICACAO', 'CONTA', 'VALOR', 'TIPO'];
    for (var index = 0; index < Math.min(rows.length, 40); index += 1) {
      var keys = rows[index].map(normalizeCashKey);
      if (required.every(function (header) { return keys.indexOf(header) >= 0; })) return index;
    }
    return -1;
  }

  function readCashFlowRows(rows, fileName) {
    var headerIndex = findCashHeaderRow(rows);
    if (headerIndex < 0) throw new Error('Cabeçalho não encontrado. Confira as colunas obrigatórias do Fluxo de Caixa.');
    var headers = rows[headerIndex].map(normalizeCashKey);
    var column = function (names) {
      for (var i = 0; i < names.length; i += 1) {
        var found = headers.indexOf(names[i]);
        if (found >= 0) return found;
      }
      return -1;
    };
    var indexes = {
      year: column(['ANO']), month: column(['MES']), date: column(['DATA']),
      client: column(['CLIENTE/FORNECEDOR', 'CLIENTE FORNECEDOR']),
      history: column(['HISTORICO']), category: column(['CATEGORIA']),
      classification: column(['CLASSIFICACAO']), account: column(['CONTA']),
      value: column(['VALOR']), type: column(['TIPO'])
    };
    var valid = [];
    var rejected = [];
    var warnings = [];
    rows.slice(headerIndex + 1).forEach(function (row, offset) {
      if (!row || !row.some(function (cell) { return normalizeCashText(cell); })) return;
      var line = headerIndex + offset + 2;
      var value = parseCashValue(row[indexes.value]);
      var date = parseCashDate(row[indexes.date]);
      var fallbackYear = Number(row[indexes.year]) || 0;
      var fallbackMonth = parseCashMonth(row[indexes.month]);
      var type = normalizeCashKey(row[indexes.type]);
      if (value == null) {
        value = 0;
        warnings.push({ line: line, reason: 'Valor vazio mantido como zero' });
      }
      if (!date) {
        if (fallbackYear && fallbackMonth) {
          date = new Date(Date.UTC(fallbackYear, fallbackMonth - 1, 1));
          warnings.push({ line: line, reason: 'Data vazia; usado o primeiro dia do ANO/Mês informado' });
        } else {
          warnings.push({ line: line, reason: 'Data e período vazios; lançamento mantido sem competência mensal' });
        }
      }
      if (type !== 'C' && type !== 'D') {
        type = value < 0 ? 'D' : 'C';
        warnings.push({ line: line, reason: 'Tipo vazio; inferido pelo sinal do valor' });
      }
      var dateYear = date ? date.getUTCFullYear() : fallbackYear;
      var dateMonth = date ? date.getUTCMonth() + 1 : fallbackMonth;
      if (date && ((Number(row[indexes.year]) && Number(row[indexes.year]) !== dateYear) ||
          (parseCashMonth(row[indexes.month]) && parseCashMonth(row[indexes.month]) !== dateMonth))) {
        warnings.push({ line: line, reason: 'ANO/Mês divergente; a Data prevaleceu' });
      }
      var record = {
        year: dateYear, month: dateMonth, date: date ? cashDateIso(date) : '', dateLabel: date ? cashDateLabel(date) : '–',
        client: normalizeCashText(indexes.client >= 0 ? row[indexes.client] : ''),
        history: normalizeCashText(indexes.history >= 0 ? row[indexes.history] : ''),
        category: normalizeCashText(row[indexes.category]),
        classification: normalizeCashText(row[indexes.classification]),
        account: normalizeCashText(row[indexes.account]),
        value: value, type: type, source: fileName, line: line
      };
      record.hash = [record.date, record.client, record.history, record.category, record.classification, normalizeCashKey(record.account), record.value].join('|');
      valid.push(record);
    });
    var seen = new Set();
    var duplicateCount = 0;
    valid.forEach(function (record) {
      if (seen.has(record.hash)) {
        duplicateCount += 1;
        warnings.push({ line: record.line, reason: 'Duplicidade mantida na importação' });
      }
      seen.add(record.hash);
    });
    return { total: rows.length - headerIndex - 1, valid: valid, rejected: rejected, warnings: warnings, duplicates: duplicateCount, fileName: fileName };
  }

  function canonicalBudgetLine(value) {
    var text = normalizeCashKey(value);
    var aliases = [
      ['FATURAMENTO TOTAL', 'Faturamento Total'],
      ['CUSTO DE PRODUTO VENDIDO', 'Custo de Produto Vendido'],
      ['CMV', 'Custo de Produto Vendido'],
      ['IMPOSTO', 'Imposto'],
      ['DESPESAS COM MKP E SITE', 'Despesas com MKP e Site'],
      ['DESPESAS MARKETPLACE', 'Despesas com MKP e Site'],
      ['MARGEM DE CONTRIBUICAO', 'Margem de Contribuição'],
      ['GASTOS FIXOS', 'Gastos Fixos'],
      ['RESULTADO R$', 'Resultado R$'],
      ['RESULTADO', 'Resultado R$']
    ];
    for (var index = 0; index < aliases.length; index += 1) {
      if (text === aliases[index][0] || text.indexOf(aliases[index][0]) >= 0) return aliases[index][1];
    }
    return '';
  }

  function readBudgetComparisonSheet(workbook) {
    var comparisonName = workbook.SheetNames.find(function (name) {
      var key = normalizeCashKey(name);
      return key.indexOf('ORC') >= 0 && key.indexOf('REALIZADO') >= 0;
    });
    if (!comparisonName) return { rows: {}, details: [], sourceSheet: '' };
    var rows = XLSX.utils.sheet_to_json(workbook.Sheets[comparisonName], { header: 1, defval: '', raw: true });
    var headerRow = -1;
    var realizedColumn = -1;
    var budgetColumn = -1;
    for (var rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
      var keys = rows[rowIndex].map(normalizeCashKey);
      var realized = keys.indexOf('REALIZADO');
      var budget = keys.indexOf('ORCADO');
      if (realized >= 0 && budget >= 0) {
        headerRow = rowIndex;
        realizedColumn = realized;
        budgetColumn = budget;
        break;
      }
    }
    if (headerRow < 0) return { rows: {}, details: [], sourceSheet: comparisonName };
    var parsed = {};
    var details = [];
    rows.slice(headerRow + 1).forEach(function (row) {
      var label = '', rawLabel = '';
      for (var cellIndex = 0; cellIndex < Math.min(realizedColumn, row.length); cellIndex += 1) {
        if (normalizeCashText(row[cellIndex])) { rawLabel = normalizeCashText(row[cellIndex]); label = canonicalBudgetLine(row[cellIndex]); break; }
      }
      if (!rawLabel) return;
      if (label) parsed[label] = {
        actual: parseCashValue(row[realizedColumn]) || 0,
        budget: parseCashValue(row[budgetColumn]) || 0
      };
      details.push({
        label: rawLabel,
        values: [parseCashValue(row[budgetColumn])],
        kind: normalizeCashKey(rawLabel) === rawLabel.toUpperCase() ? 'group' : 'detail',
        comment: normalizeCashText(row[budgetColumn + 2])
      });
    });
    return { rows: parsed, details: details, sourceSheet: comparisonName };
  }

  function readBudgetPlanSheet(workbook) {
    var budgetName = workbook.SheetNames.find(function (name) {
      var key = normalizeCashKey(name);
      return key.indexOf('ORCAMENTO') >= 0 && key.indexOf('REALIZADO') < 0;
    });
    if (!budgetName) return { rows: {}, details: [], sourceSheet: '' };
    var rows = XLSX.utils.sheet_to_json(workbook.Sheets[budgetName], { header: 1, defval: '', raw: true });
    var januaryColumns = [];
    rows.slice(0, 80).forEach(function (row, rowIndex) {
      row.forEach(function (cell, columnIndex) {
        if (['JANEIRO', 'JAN'].indexOf(normalizeCashKey(cell)) >= 0) januaryColumns.push({ row: rowIndex, column: columnIndex });
      });
    });
    if (!januaryColumns.length) return { rows: {}, details: [], sourceSheet: budgetName };
    var selectedHeader = januaryColumns[januaryColumns.length - 1];
    var parsed = {};
    var details = [];
    rows.slice(selectedHeader.row + 1).forEach(function (row) {
      var label = '', rawLabel = '';
      for (var cellIndex = 0; cellIndex < selectedHeader.column; cellIndex += 1) {
        if (normalizeCashText(row[cellIndex])) { rawLabel = normalizeCashText(row[cellIndex]); label = canonicalBudgetLine(row[cellIndex]); }
      }
      if (!rawLabel) return;
      var value = parseCashValue(row[selectedHeader.column]);
      if (label && value != null) parsed[label] = { actual: 0, budget: value };
      var values = months.map(function (_, monthIndex) { return parseCashValue(row[selectedHeader.column + monthIndex]); });
      if (values.some(function (item) { return item != null; })) details.push({
        label: rawLabel,
        values: values,
        kind: normalizeCashKey(rawLabel) === rawLabel.toUpperCase() ? 'group' : 'detail'
      });
    });
    return { rows: parsed, details: details, sourceSheet: budgetName };
  }

  function parseCashCsv(text) {
    var firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
    var delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var index = 0; index < text.length; index += 1) {
      var char = text[index];
      var next = text[index + 1];
      if (char === '"') {
        if (quoted && next === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(cell); cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some(function (value) { return String(value).trim(); })) rows.push(row);
        row = []; cell = '';
      } else {
        cell += char;
      }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function handleCashFlowFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var previewBox = document.getElementById('cashImportPreview');
    previewBox.innerHTML = '<div class="closing-import"><strong>Lendo ' + escapeCashHtml(file.name) + '…</strong></div>';
    try {
      if (typeof XLSX === 'undefined') throw new Error('Leitor de Excel não está disponível.');
      var isCsv = /\.csv$/i.test(file.name);
      var workbook = null;
      var rows;
      if (isCsv) {
        rows = parseCashCsv(await file.text());
      } else {
        var source = await file.arrayBuffer();
        workbook = XLSX.read(source, { type: 'array', cellDates: true });
        var sheetName = workbook.SheetNames.find(function (name) { return normalizeCashKey(name) === 'FLUXO DE CAIXA'; }) || workbook.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
      }
      cashFlowState.preview = readCashFlowRows(rows, file.name);
      var comparison = workbook ? readBudgetComparisonSheet(workbook) : { rows: {}, sourceSheet: '' };
      var plan = workbook ? readBudgetPlanSheet(workbook) : { rows: {}, details: [], sourceSheet: '' };
      if (workbook && comparison.details.length) {
        var comments = {};
        comparison.details.forEach(function (row) { if (row.comment) comments[normalizeCashKey(row.label)] = row.comment; });
        plan.details.forEach(function (row) { row.comment = comments[normalizeCashKey(row.label)] || ''; });
      }
      cashFlowState.preview.budget = plan.details.length ? plan : comparison;
      renderCashFlowPreview();
    } catch (error) {
      previewBox.innerHTML = '<div class="closing-import negative"><strong>Não foi possível ler o arquivo.</strong><br>' + escapeCashHtml(error.message) + '</div>';
    } finally {
      event.target.value = '';
    }
  }

  function renderCashFlowPreview() {
    var preview = cashFlowState.preview;
    var box = document.getElementById('cashImportPreview');
    if (!preview || !box) return;
    var entries = preview.valid.filter(function (record) { return record.value > 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var exits = preview.valid.filter(function (record) { return record.value < 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var dates = preview.valid.map(function (record) { return record.date; }).sort();
    var period = dates.length ? cashDateLabel(new Date(dates[0] + 'T00:00:00Z')) + ' a ' + cashDateLabel(new Date(dates[dates.length - 1] + 'T00:00:00Z')) : '–';
    box.innerHTML = '<div class="closing-import"><strong>Prévia de ' + escapeCashHtml(preview.fileName) + '</strong><br>' +
      preview.total.toLocaleString('pt-BR') + ' linhas lidas · <span class="positive">' + preview.valid.length.toLocaleString('pt-BR') +
      ' válidas</span> · <span class="' + (preview.rejected.length ? 'negative' : 'positive') + '">' +
      preview.rejected.length.toLocaleString('pt-BR') + ' rejeitadas</span> · ' + preview.warnings.length.toLocaleString('pt-BR') +
      ' avisos não bloqueantes · ' + (preview.duplicates || 0).toLocaleString('pt-BR') +
      ' duplicidades mantidas<br>Período: ' + period + ' · Entradas: ' + money(entries) + ' · Saídas: ' + money(exits) + ' · Saldo: ' +
      money(entries + exits) + '<br>Orçamento: ' + (preview.budget && Object.keys(preview.budget.rows).length
        ? Object.keys(preview.budget.rows).length + ' linhas encontradas na aba ' + escapeCashHtml(preview.budget.sourceSheet)
        : 'nenhuma aba compatível encontrada') +
      (preview.rejected.length ? '<br>Primeiras rejeições: ' + preview.rejected.slice(0, 5).map(function (item) { return 'linha ' + item.line + ' (' + item.reason + ')'; }).join('; ') : '') +
      '<div class="closing-actions" style="margin-top:12px"><button class="closing-button primary" id="cashOnlyNewButton" type="button">Confirmar arquivo completo</button>' +
      '<button class="closing-button" id="cashReplaceButton" type="button">Substituir período</button><button class="closing-button" id="cashCancelButton" type="button">Cancelar</button></div></div>';
    document.getElementById('cashOnlyNewButton').addEventListener('click', function () { confirmCashFlowImport('new'); });
    document.getElementById('cashReplaceButton').addEventListener('click', function () { confirmCashFlowImport('replace'); });
    document.getElementById('cashCancelButton').addEventListener('click', function () { cashFlowState.preview = null; box.innerHTML = ''; });
  }

  function confirmCashFlowImport(mode) {
    var preview = cashFlowState.preview;
    if (!preview) return;
    var current = cashFlowState.records.slice();
    if (mode === 'replace' && preview.valid.length) {
      var dates = preview.valid.map(function (record) { return record.date; }).sort();
      current = current.filter(function (record) { return record.date < dates[0] || record.date > dates[dates.length - 1]; });
    }
    preview.valid.forEach(function (record) {
      current.push(record);
    });
    current.sort(function (a, b) { return a.date.localeCompare(b.date) || a.line - b.line; });
    cashFlowState.records = current;
    cashFlowState.fileName = preview.fileName;
    cashFlowState.importedAt = new Date().toISOString();
    cashFlowState.preview = null;
    if (preview.budget && Object.keys(preview.budget.rows).length) {
      budgetState.rows = preview.budget.rows;
      budgetState.details = preview.budget.details || [];
      budgetState.sourceSheet = preview.budget.sourceSheet;
    }
    rebuildCashSummaryFromRecords();
    saveClosingState();
    renderCashFlow();
    renderSummary();
    renderBudget();
  }

  function rebuildCashSummaryFromRecords() {
    Object.keys(reference).forEach(function (key) { reference[key] = months.map(function () { return 0; }); });
    cashFlowState.records.forEach(function (record) {
      var index = record.month - 1;
      var classification = normalizeCashKey(record.classification);
      if (classification === 'RECEITAS' || classification === 'JUROS SOBRE INVESTIMENTO') reference.receipts[index] += record.value;
      if (classification === 'PRODUTOS') reference.products[index] += record.value;
      if (['PRODUTOS', 'EMBALAGEM', 'IMPOSTO SOBRE MERCADORIA VENDIDA'].indexOf(classification) >= 0) reference.salesCost[index] += record.value;
      var order = mappings.find(function (mapping) { return normalizeCashKey(mapping[1]) === classification; });
      if (order && order[2] >= 6 && order[2] <= 16) reference.fixed[index] += record.value;
      if (order && order[2] >= 17 && order[2] <= 21) reference.variable[index] += record.value;
      if (record.type === 'D') reference.paid[index] += record.value;
    });
    months.forEach(function (_, index) {
      reference.contribution[index] = reference.receipts[index] + reference.salesCost[index];
      reference.operating[index] = reference.contribution[index] + reference.fixed[index];
      reference.cash[index] = reference.operating[index] + reference.variable[index];
    });
  }

  function getCashSummaryYears() {
    return Array.from(new Set(cashFlowState.records.map(function (record) { return record.year; }).filter(Boolean))).sort(function (a, b) { return b - a; });
  }

  function sumCashRows(records, month) {
    return records.filter(function (record) { return record.month === month; })
      .reduce(function (total, record) { return total + record.value; }, 0);
  }

  function createCashSummaryValue(label, month, value, previous) {
    var detailKey = arguments.length > 4 ? arguments[4] : '';
    var comparison = previous == null ? '' : '<small class="closing-compare ' + numberClass(value - previous) + '">' +
      (value - previous > 0 ? '▲ ' : value - previous < 0 ? '▼ ' : '') + money(value - previous) + ' vs. mês anterior</small>';
    return '<button class="closing-value ' + numberClass(value) + '" type="button" data-closing-value="' +
      encodeURIComponent(label) + '" data-month="' + month + '" data-value="' + value + '" data-previous="' +
      (previous == null ? '' : previous) + '" data-detail-key="' + detailKey + '" data-source="fluxo">' + money(value) + comparison + '</button>';
  }

  function buildCashSummaryHierarchy(records, activeMonths) {
    var hierarchyYear = records.length ? records[0].year : 0;
    var classifications = [];
    var byClassification = new Map();
    records.forEach(function (record) {
      var classification = record.classification || 'Sem classificação';
      if (!byClassification.has(classification)) {
        byClassification.set(classification, []);
        classifications.push(classification);
      }
      byClassification.get(classification).push(record);
    });
    classifications.sort(function (a, b) { return getFinancialOrder(a, false) - getFinancialOrder(b, false); });
    var body = [];
    classifications.forEach(function (classification, classificationIndex) {
      var classificationRows = byClassification.get(classification);
      var classificationId = 'cash-' + hierarchyYear + '-class-' + classificationIndex;
      body.push(createCashHierarchyRow(classification, classificationRows, activeMonths, 'classification', classificationId, '', true));
      var categories = [];
      var byCategory = new Map();
      classificationRows.forEach(function (record) {
        var category = record.category || 'Sem categoria';
        if (!byCategory.has(category)) { byCategory.set(category, []); categories.push(category); }
        byCategory.get(category).push(record);
      });
      categories.sort(function (a, b) { return getFinancialOrder(a, true) - getFinancialOrder(b, true); });
      categories.forEach(function (category, categoryIndex) {
        var categoryRows = byCategory.get(category);
        categoryRows.sort(function (a, b) { return (a.line || 0) - (b.line || 0); });
        var categoryId = classificationId + '-cat-' + categoryIndex;
        body.push(createCashHierarchyRow(category, categoryRows, activeMonths, 'category', categoryId, classificationId, true));
        var clients = [];
        var byClient = new Map();
        categoryRows.forEach(function (record) {
          var client = record.client || 'Sem cliente / fornecedor';
          if (!byClient.has(client)) { byClient.set(client, []); clients.push(client); }
          byClient.get(client).push(record);
        });
        clients.forEach(function (client, clientIndex) {
          body.push(createCashHierarchyRow(client, byClient.get(client), activeMonths, 'launch',
            categoryId + '-client-' + clientIndex, categoryId, false));
        });
      });
    });
    return body.join('');
  }

  function getFinancialOrder(label, category) {
    var key = normalizeCashKey(label);
    var found = mappings.find(function (mapping) {
      return normalizeCashKey(mapping[category ? 0 : 1]) === key;
    });
    return found ? Number(found[2]) : 500;
  }

  function createCashHierarchyRow(label, records, activeMonths, level, rowId, parentId, expandable) {
    var cells = activeMonths.map(function (month, index) {
      var value = sumCashRows(records, month);
      var previousMonth = index ? activeMonths[index - 1] : 0;
      var previous = previousMonth && previousMonth === month - 1 ? sumCashRows(records, previousMonth) : null;
      var detailKey = rowId + '-month-' + month;
      cashHoverDetails[detailKey] = records.filter(function (record) { return record.month === month; });
      return '<td>' + createCashSummaryValue(label, month, value, previous, detailKey) + '</td>';
    }).join('');
    var total = records.reduce(function (sumValue, record) { return sumValue + record.value; }, 0);
    return '<tr class="cash-hierarchy-row cash-level-' + level + (parentId ? ' cash-hidden' : '') +
      '" data-cash-row="' + rowId + '" data-cash-parent="' + parentId + '"><td>' +
      (expandable ? '<button class="cash-expand" type="button" aria-label="Abrir ' + escapeCashHtml(label) +
        '" aria-expanded="false">+</button>' : '<span class="cash-expand-spacer" aria-hidden="true">•</span>') +
      escapeCashHtml(label) + (level === 'launch' ? '<small>' + records.length.toLocaleString('pt-BR') +
        (records.length === 1 ? ' lançamento' : ' lançamentos') + ' consolidados</small>' : '') +
      '</td>' + cells + '<td class="' + numberClass(total) + '">' + money(total) + '</td></tr>';
  }

  function buildDreClassificationHierarchy(label, records, activeMonths, classificationIndex) {
    var classificationId = 'dre-class-' + classificationIndex;
    var body = [createCashHierarchyRow(label, records, activeMonths, 'classification', classificationId, '', true)];
    var categories = [];
    var byCategory = new Map();
    records.forEach(function (record) {
      var category = record.category || 'Sem categoria';
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        categories.push(category);
      }
      byCategory.get(category).push(record);
    });
    categories.sort(function (a, b) {
      return getFinancialOrder(a, true) - getFinancialOrder(b, true) || String(a).localeCompare(String(b), 'pt-BR');
    });
    categories.forEach(function (category, categoryIndex) {
      var categoryRows = byCategory.get(category);
      categoryRows.sort(function (a, b) { return (a.line || 0) - (b.line || 0); });
      var categoryId = classificationId + '-cat-' + categoryIndex;
      body.push(createCashHierarchyRow(category, categoryRows, activeMonths, 'category', categoryId, classificationId, true));
      var clients = [];
      var byClient = new Map();
      categoryRows.forEach(function (record) {
        var client = record.client || 'Sem cliente / fornecedor';
        if (!byClient.has(client)) {
          byClient.set(client, []);
          clients.push(client);
        }
        byClient.get(client).push(record);
      });
      clients.sort(function (a, b) { return String(a).localeCompare(String(b), 'pt-BR'); });
      clients.forEach(function (client, clientIndex) {
        body.push(createCashHierarchyRow(client, byClient.get(client), activeMonths, 'launch',
          categoryId + '-client-' + clientIndex, categoryId, false));
      });
    });
    return body.join('');
  }

  function renderSummary(selectedYear) {
    var container = document.getElementById('cashSummaryContainer');
    if (!container) return;
    var years = getCashSummaryYears();
    var year = Number(selectedYear) || years[0] || new Date().getFullYear();
    var records = cashFlowState.records.filter(function (record) { return record.year === year; });
    var activeMonths = Array.from(new Set(records.map(function (record) { return record.month; }).filter(Boolean))).sort(function (a, b) { return a - b; });
    var entries = records.filter(function (record) { return record.value > 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var exits = records.filter(function (record) { return record.value < 0; }).reduce(function (total, record) { return total + record.value; }, 0);
    var yearOptions = (years.length ? years : [year]).map(function (item) {
      return '<option value="' + item + '"' + (item === year ? ' selected' : '') + '>' + item + '</option>';
    }).join('');
    var actions = '<label>Ano <select class="closing-select" id="cashSummaryYear">' + yearOptions + '</select></label>';
    var table = records.length && activeMonths.length
      ? '<div class="closing-card"><div class="closing-card-head"><h3>Classificações, categorias e lançamentos</h3><span class="closing-pill">' +
        activeMonths.map(function (month) { return months[month - 1]; }).join('–') + ' · somente meses importados</span></div><div class="closing-table-wrap"><table class="closing-table cash-hierarchy-table"><thead><tr><th>Classificação / Categoria / Lançamento</th>' +
        activeMonths.map(function (month) { return '<th>' + months[month - 1] + '</th>'; }).join('') +
        '<th>TOTAL</th></tr></thead><tbody>' + buildCashSummaryHierarchy(records, activeMonths) + '</tbody></table></div></div>'
      : '<div class="closing-import"><strong>Nenhum lançamento importado para ' + year + '.</strong><br>Os meses e a hierarquia aparecerão somente depois da leitura do arquivo.</div>';
    container.innerHTML = '<div class="closing-shell">' +
      head('Resumo de Fluxo de Caixa', 'Hierarquia fiel ao arquivo: classificação, categoria e lançamento, sem criar meses ou linhas artificiais.', actions) +
      kpis([['Entradas acumuladas', entries], ['Saídas acumuladas', exits], ['Saldo realizado', entries + exits], ['Saldo acumulado', entries + exits]]) +
      table + '</div>';
    var yearSelect = document.getElementById('cashSummaryYear');
    if (yearSelect) yearSelect.addEventListener('change', function () { renderSummary(yearSelect.value); });
    bindCashExpandButtons(container);
  }

  function toggleCashHierarchy(parentId, opening, scope) {
    Array.from((scope || document).querySelectorAll('[data-cash-parent="' + parentId + '"]')).forEach(function (row) {
      row.classList.toggle('cash-hidden', !opening);
      if (!opening) {
        var button = row.querySelector('.cash-expand');
        if (button) button.textContent = '+';
        toggleCashHierarchy(row.dataset.cashRow, false, scope);
      }
    });
  }

  window.toggleClosingCashHierarchy = function (button) {
    var hierarchyRow = button.closest('[data-cash-row]');
    var opening = button.textContent === '+';
    button.textContent = opening ? '−' : '+';
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    toggleCashHierarchy(hierarchyRow.dataset.cashRow, opening, button.closest('.closing-shell'));
  };

  function bindCashExpandButtons(container) {
    Array.from(container.querySelectorAll('.cash-expand')).forEach(function (button) {
      button.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        window.toggleClosingCashHierarchy(button);
      };
    });
  }

  function renderDre() {
    var year = 2026;
    var yearRecords = cashFlowState.records.filter(function (record) { return record.year === year; });
    var activeMonths = Array.from(new Set(yearRecords
      .map(function (record) { return record.month; }).filter(Boolean))).sort(function (a, b) { return a - b; });
    var structure = dreStructure.length ? dreStructure : [
      { label: 'FATURAMENTO TOTAL', subtotal: 0 }, { label: 'CUSTO DE PRODUTO VENDIDO', subtotal: 0 },
      { label: 'IMPOSTO', subtotal: 0 }, { label: 'DESPESAS COM MKP E SITE', subtotal: 0 },
      { label: 'MARGEM DE CONTRIBUIÇÃO TOTAL R$', subtotal: 1 }, { label: 'RESULTADO R$', subtotal: 1 }
    ];
    var rows = structure.map(function (line) {
      return { label: line.label, subtotal: Number(line.subtotal) || 0, values: activeMonths.map(function (month) {
        return getDreActual(line.label, month, year);
      }) };
    });
    var marginIndex = rows.findIndex(function (row) {
      return normalizeCashKey(row.label).indexOf('MARGEM DE CONTRIBUICAO TOTAL R$') >= 0;
    });
    var body = rows.map(function (row, rowIndex) {
      var classificationRows = rowIndex > marginIndex ? yearRecords.filter(function (record) {
        return normalizeCashKey(record.classification) === normalizeCashKey(row.label);
      }) : [];
      if (classificationRows.length) {
        return buildDreClassificationHierarchy(row.label, classificationRows, activeMonths, rowIndex);
      }
      var isPercent = row.subtotal === 2 || /%/.test(row.label);
      var cells = row.values.map(function (value, index) {
        return '<td class="' + numberClass(value) + '">' + (isPercent
          ? new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value)
          : numericButton(row.label, activeMonths[index], value, 'dre')) + '</td>';
      }).join('');
      var total = isPercent ? (row.values[row.values.length - 1] || 0) : sum(row.values);
      return '<tr class="' + (row.subtotal ? 'total-row' : '') + '"><td>' + escapeCashHtml(row.label) + '</td>' + cells +
        '<td class="' + numberClass(total) + '">' + (isPercent
          ? new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(total) : money(total)) + '</td></tr>';
    }).join('');
    var revenue = sum(activeMonths.map(function (month) {
      return getDreActual('FATURAMENTO TOTAL', month, year);
    }));
    var margin = sum(activeMonths.map(function (month) {
      return getDreActual('MARGEM DE CONTRIBUIÇÃO TOTAL R$', month, year);
    }));
    var operating = sum(activeMonths.map(function (month) {
      return getDreActual('RESULTADO OPERACIONAL R$', month, year);
    }));
    var result = sum(activeMonths.map(function (month) {
      return getDreActual('RESULTADO R$', month, year);
    }));
    document.getElementById('dreContainer').innerHTML = '<div class="closing-shell">' +
      head('DRE Mensal e Anual', 'Topo e margem pela base de vendas; despesas posteriores pelo fluxo de caixa.', yearControl()) +
      kpis([['Faturamento Total', revenue], ['Margem contribuição Total', margin], ['Resultado operacional Total', operating], ['Resultado Total', result]]) +
      '<div class="closing-card"><div class="closing-card-head"><h3>Estrutura DRE</h3><span class="closing-pill">Somente meses realizados</span></div>' +
      '<div class="closing-table-wrap"><table class="closing-table"><thead><tr><th>Linha DRE</th>' +
      activeMonths.map(function (month) { return '<th>' + months[month - 1] + '</th>'; }).join('') +
      '<th>TOTAL</th></tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
  }

  function getDreActual(label, month, year) {
    var key = normalizeCashKey(label);
    var salesMonth = salesDre.year === year && salesDre.months ? salesDre.months[String(month)] : null;
    var salesRevenue = salesMonth ? Number(salesMonth.revenue) || 0 : 0;
    var salesCmv = salesMonth ? Number(salesMonth.cmv) || 0 : 0;
    var salesTax = salesMonth ? Number(salesMonth.tax) || 0 : 0;
    var salesMkp = salesMonth ? Number(salesMonth.mkp) || 0 : 0;
    var salesContribution = salesMonth && Number.isFinite(Number(salesMonth.contribution))
      ? Number(salesMonth.contribution)
      : salesRevenue + salesCmv + salesTax + salesMkp;
    var records = cashFlowState.records.filter(function (record) { return record.year === year && record.month === month; });
    var totalFor = function (predicate) { return records.filter(predicate).reduce(function (total, record) { return total + record.value; }, 0); };
    var receipts = totalFor(function (record) { return ['RECEITAS', 'JUROS SOBRE INVESTIMENTO'].indexOf(normalizeCashKey(record.classification)) >= 0; });
    var cmv = totalFor(function (record) { return normalizeCashKey(record.classification) === 'PRODUTOS'; });
    var tax = totalFor(function (record) { return normalizeCashKey(record.classification).indexOf('IMPOSTO') >= 0; });
    var mkp = totalFor(function (record) { return ['DESPESAS COM ADS', 'DESPESAS COM FULL', 'DESPESAS COMERCIAIS'].indexOf(normalizeCashKey(record.classification)) >= 0; });
    var contribution = receipts + cmv + tax + mkp;
    var fixed = totalFor(function (record) {
      var order = mappings.find(function (mapping) { return normalizeCashKey(mapping[1]) === normalizeCashKey(record.classification); });
      return order && order[2] >= 6 && order[2] <= 16;
    });
    var variable = totalFor(function (record) {
      var order = mappings.find(function (mapping) { return normalizeCashKey(mapping[1]) === normalizeCashKey(record.classification); });
      return order && order[2] >= 17 && order[2] <= 21;
    });
    if (key === 'FATURAMENTO TOTAL') return salesRevenue;
    if (key === 'CUSTO DE PRODUTO VENDIDO') return salesCmv;
    if (key === 'IMPOSTO') return salesTax;
    if (key.indexOf('DESPESAS COM MKP') >= 0) return salesMkp;
    if (key.indexOf('MARGEM DE CONTRIBUICAO TOTAL R$') >= 0) return salesContribution;
    if (key.indexOf('MARGEM DE CONTRIBUICAO TOTAL %') >= 0) return salesRevenue ? salesContribution / salesRevenue : 0;
    if (key.indexOf('RESULTADO OPERACIONAL R$') >= 0) return salesContribution + fixed;
    if (key.indexOf('RESULTADO OPERACIONAL %') >= 0) return salesRevenue ? (salesContribution + fixed) / salesRevenue : 0;
    if (key.indexOf('CUSTO VARIADO R$') >= 0) return variable;
    if (key.indexOf('CUSTO VARIADO %') >= 0) return receipts ? variable / receipts : 0;
    if (key === 'CUSTO TOTAL') return salesCmv + salesTax + salesMkp + fixed + variable;
    if (key === 'RESULTADO R$') return salesContribution + fixed + variable;
    if (key === 'RESULTADO %') return salesRevenue ? (salesContribution + fixed + variable) / salesRevenue : 0;
    return totalFor(function (record) { return normalizeCashKey(record.classification) === key; });
  }

  function renderBudget(selectedMonth) {
    var budgetYear = 2026;
    var month = Math.min(12, Math.max(1, Number(selectedMonth) || 1));
    var details = Array.isArray(budgetState.details) && budgetState.details.length ? budgetState.details :
      Object.keys(budgetState.rows || {}).map(function (label) { return { label: label, values: [budgetState.rows[label].budget], kind: 'group' }; });
    var classificationKeys = new Set(mappings.map(function (mapping) {
      return normalizeCashKey(mapping[1]);
    }));
    var standaloneKeys = new Set([
      'FATURAMENTO TOTAL META', 'FATURAMENTO TOTAL MINIMO', 'CUSTO DE PRODUTO VENDIDO',
      'IMPOSTO', 'DESPESAS COM MKP E SITE', 'MCR$', 'MC%', 'MARGEM DE CONTRIBUICAO',
      'RESULTADO OPERACIONAL R$', 'RESULTADO OPERACIONAL %', 'CUSTO VARIADO R$',
      'CUSTO VARIADO %', 'CUSTO TOTAL', 'RESULTADO R$', 'RESULTADO %'
    ]);
    var currentClassification = '';
    var classificationIndex = 0;
    var rows = details.map(function (row) {
      var budget = ((row.values || [])[month - 1] == null ? 0 : row.values[month - 1]);
      var actual = getCashActualForBudgetLine(row.label, month, budgetYear);
      var key = normalizeCashKey(row.label);
      var isClassification = classificationKeys.has(key);
      var isStandalone = standaloneKeys.has(key);

      if (isClassification) {
        classificationIndex += 1;
        currentClassification = 'budget-class-' + classificationIndex;
      } else if (isStandalone) {
        currentClassification = '';
      }
      if (actual < 0 && budget > 0) budget = -budget;
      return {
        label: row.label,
        actual: actual,
        budget: budget,
        kind: isClassification ? 'classification' : (currentClassification ? 'category' : 'standalone'),
        rowId: isClassification ? currentClassification : '',
        parentId: !isClassification && currentClassification ? currentClassification : '',
        comment: row.comment || ''
      };
    });
    var body = rows.map(function (r) {
      var variance = r.actual - r.budget;
      var percent = r.budget ? variance / Math.abs(r.budget) : null;
      var favorable = variance > 0;
      var status = Math.abs(percent || 0) <= .05 ? 'neutral' : favorable ? 'good' : 'bad';
      var label = status === 'neutral' ? 'Neutro' : favorable ? 'Favorável' : 'Desfavorável';
      var comment = localStorage.getItem('closing-comment-' + r.label) || r.comment;
      var hierarchyAttributes = r.rowId
        ? ' data-cash-row="' + r.rowId + '"'
        : (r.parentId ? ' class="cash-hidden budget-category" data-cash-parent="' + r.parentId + '"' : '');
      var hierarchyLabel = r.rowId
        ? '<button type="button" class="cash-expand" aria-expanded="false" aria-label="Abrir ' +
          escapeCashHtml(r.label) + '">+</button><strong>' + escapeCashHtml(r.label) + '</strong>'
        : (r.parentId ? '<span class="budget-category-label">' + escapeCashHtml(r.label) + '</span>' : escapeCashHtml(r.label));
      var rowClass = r.parentId ? '' : ' class="budget-' + r.kind + (r.rowId ? ' total-row' : '') + '"';
      return '<tr' + rowClass + hierarchyAttributes + '><td>' + hierarchyLabel + '</td><td>' +
        numericButton(r.label, month, r.actual, 'orcamento') + '</td><td>' + money(r.budget) +
        '</td><td class="' + numberClass(variance) + '">' + money(variance) + '</td><td>' +
        (percent == null ? '–' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(percent)) +
        '</td><td>' + (r.budget ? new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(r.actual / r.budget) : '–') +
        '</td><td><span class="closing-status ' + status + '">' + label + '</span></td><td><input class="closing-input budget-comment" data-line="' +
        encodeURIComponent(r.label) + '" value="' + escapeCashHtml(comment) + '" placeholder="Adicionar comentário"></td></tr>';
    }).join('');
    var monthOptions = Array.from({ length: 12 }, function (_, index) { return index + 1; }).map(function (item) {
      return '<option value="' + item + '"' + (item === month ? ' selected' : '') + '>' + budgetState.months[item - 1] + '</option>';
    }).join('');
    document.getElementById('budgetContainer').innerHTML = '<div class="closing-shell">' +
      head('Orçado x Realizado', 'Visão mensal por classificação e categoria; realizado recalculado pelo Fluxo de Caixa.',
        yearControl() + '<select class="closing-select" id="budgetMonth">' + monthOptions + '</select>') +
      '<div class="closing-card"><div class="closing-card-head"><h3>Comparativo mensal · ' + budgetState.months[month - 1] +
      '</h3><span class="closing-pill">' +
      (budgetState.sourceSheet ? 'Origem: ' + escapeCashHtml(budgetState.sourceSheet) : 'Aguardando importação do orçamento') +
      '</span></div><div class="closing-table-wrap"><table class="closing-table"><thead><tr><th>Classificação / Categoria</th><th>Realizado</th><th>Orçado</th><th>Variação R$</th><th>Variação %</th><th>Atingimento</th><th>Status</th><th>Comentário</th></tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
    Array.from(document.querySelectorAll('.budget-comment')).forEach(function (input) {
      input.addEventListener('change', function () { localStorage.setItem('closing-comment-' + decodeURIComponent(input.dataset.line), input.value); });
    });
    var selector = document.getElementById('budgetMonth');
    if (selector) selector.addEventListener('change', function () { renderBudget(selector.value); });
    bindCashExpandButtons(document.getElementById('budgetContainer'));
  }

  function getCashActualForBudgetLine(label, selectedMonth, year) {
    var key = normalizeCashKey(label);
    if (key.indexOf('FATURAMENTO TOTAL') >= 0) {
      if (selectedMonth === 'accumulated') {
        return Object.keys(salesDre.months || {}).reduce(function (total, monthKey) {
          return total + (Number(salesDre.months[monthKey].revenue) || 0);
        }, 0);
      }
      var salesMonth = salesDre.year === year && salesDre.months ? salesDre.months[String(selectedMonth)] : null;
      return salesMonth ? Number(salesMonth.revenue) || 0 : 0;
    }
    var selected = cashFlowState.records.filter(function (record) {
      return record.year === year && (selectedMonth === 'accumulated' || record.month === selectedMonth);
    });
    var direct = selected.filter(function (record) {
      return normalizeCashKey(record.classification) === key || normalizeCashKey(record.category) === key;
    });
    if (direct.length) return direct.reduce(function (total, record) { return total + record.value; }, 0);
    var matched = [];
    if (key.indexOf('CUSTO DE PRODUTO VENDIDO') >= 0 || key === 'CMV') matched = selected.filter(function (record) { return normalizeCashKey(record.classification) === 'PRODUTOS'; });
    else if (key === 'IMPOSTO') matched = selected.filter(function (record) { return normalizeCashKey(record.classification).indexOf('IMPOSTO') >= 0; });
    else if (key.indexOf('DESPESAS COM MKP') >= 0) matched = selected.filter(function (record) { return ['DESPESAS COM ADS', 'DESPESAS COM FULL', 'DESPESAS COMERCIAIS'].indexOf(normalizeCashKey(record.classification)) >= 0; });
    return matched.reduce(function (total, record) { return total + record.value; }, 0);
  }

  function renderMapping(filter) {
    var container = document.getElementById('mappingContainer');
    var needle = String(filter || '').toLocaleLowerCase('pt-BR');
    var filtered = mappings.filter(function (row) { return !needle || (row[0] + ' ' + row[1]).toLocaleLowerCase('pt-BR').indexOf(needle) >= 0; });
    container.innerHTML = '<div class="closing-shell">' +
      head('De-Para Financeiro', 'Administração de categorias analíticas e suas classificações sintéticas.',
        '<input class="closing-input mapping-search" id="mappingSearch" placeholder="Buscar categoria ou classificação" value="' + (filter || '') + '"><button class="closing-button primary" type="button">Nova regra</button>') +
      '<div class="closing-card"><div class="closing-card-head"><h3>Categorias classificadas</h3><span class="closing-pill">' + filtered.length + ' regras exibidas · 126 no seed</span></div><div class="closing-table-wrap"><table class="closing-table"><thead><tr><th>Categoria</th><th>Classificação</th><th>Ordem</th><th>Natureza</th><th>Status</th></tr></thead><tbody>' +
      filtered.map(function (r) { var nature = r[2] <= 2 ? 'Receita' : r[2] <= 5 ? 'Custo venda' : r[2] <= 16 ? 'Gasto fixo' : r[2] <= 21 ? 'Custo variável' : 'Transferência'; return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + nature + '</td><td><span class="closing-status good">Mapeada</span></td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
    document.getElementById('mappingSearch').addEventListener('input', function (event) { renderMapping(event.target.value); });
  }

  function showVariation(event) {
    var target = event.target.closest('[data-closing-value]');
    if (!target) return;
    var value = Number(target.dataset.value);
    var month = Number(target.dataset.month);
    var previousAttribute = target.dataset.previous;
    var previous = previousAttribute === undefined || previousAttribute === '' ? null : Number(previousAttribute);
    var variance = value - previous;
    var details = cashHoverDetails[target.dataset.detailKey] || [];
    var detailsHtml = details.length ? '<div class="closing-hover-details"><b>Lançamentos deste valor</b>' +
      details.slice(0, 12).map(function (record) {
        return '<div><span>' + escapeCashHtml(record.dateLabel + ' · ' + (record.client || 'Sem cliente')) +
          '<small>' + escapeCashHtml(record.history || record.category || 'Sem histórico') + '</small></span><strong class="' +
          numberClass(record.value) + '">' + money(record.value) + '</strong></div>';
      }).join('') + (details.length > 12 ? '<em>+' + (details.length - 12).toLocaleString('pt-BR') +
        ' lançamentos neste mês</em>' : '') + '</div>' : '';
    var pop = document.getElementById('closingVariationPopover');
    pop.innerHTML = '<h4>' + decodeURIComponent(target.dataset.closingValue) + ' · ' + (month === 13 ? 'TOTAL/2026' : months[month - 1] + '/2026') + '</h4><strong class="' + numberClass(value) + '">' + money(value) + '</strong>' +
      '<div class="closing-popover-grid">' +
      (previous == null ? '<span>Mês anterior</span><b>n/a</b>' : '<span>Mês anterior</span><b>' + money(previous) + '</b><span>Variação</span><b class="' + numberClass(variance) + '">' + money(variance) + '</b>') +
      '</div>' + detailsHtml +
      '<div class="closing-spark" aria-label="Tendência dos últimos 12 meses">' + [3, 7, 5, 9, 6, 11, 8, 12, 10, 14, 9, 15].map(function (h) { return '<i style="height:' + (h * 2) + 'px"></i>'; }).join('') + '</div>';
    pop.hidden = false;
    var rect = target.getBoundingClientRect();
    pop.style.left = Math.min(rect.left, window.innerWidth - 380) + 'px';
    pop.style.top = Math.min(rect.bottom + 8, window.innerHeight - 260) + 'px';
    pop.focus();
  }

  async function boot() {
    var restored = loadClosingState();
    await loadFinancialSeed(restored);
    await refreshSalesRevenueFromDashboardUploads();
    rebuildCashSummaryFromRecords();
    var pop = document.createElement('div');
    pop.id = 'closingVariationPopover';
    pop.className = 'closing-popover';
    pop.hidden = true;
    pop.tabIndex = -1;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Variação mês a mês');
    document.body.appendChild(pop);

    renderCashFlow();
    renderSummary();
    renderDre();
    renderBudget();
    renderMapping('');
    bindCashExpandButtons(document.getElementById('dreContainer'));
    Array.from(document.querySelectorAll('[data-tab="drePanel"], [data-tab="budgetPanel"]')).forEach(function (button) {
      button.addEventListener('click', async function () {
        await refreshSalesRevenueFromDashboardUploads();
        renderDre();
        bindCashExpandButtons(document.getElementById('dreContainer'));
        renderBudget();
      });
    });
    document.addEventListener('mouseover', function (event) {
      var valueTarget = event.target.closest('[data-closing-value][data-detail-key]');
      if (valueTarget && cashHoverDetails[valueTarget.dataset.detailKey] && cashHoverDetails[valueTarget.dataset.detailKey].length) {
        showVariation(event);
      }
    });
    document.addEventListener('click', function (event) {
      var expandButton = event.target.closest('.cash-expand');
      if (expandButton) {
        return;
      } else if (event.target.closest('[data-closing-value]')) {
        showVariation(event);
      } else if (!event.target.closest('#closingVariationPopover')) {
        pop.hidden = true;
      }
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') pop.hidden = true; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
