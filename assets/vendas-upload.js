(function () {
  'use strict';

  var fileInput = document.getElementById('salesIntegrationFile');
  var passwordInput = document.getElementById('salesIntegrationPassword');
  var previewButton = document.getElementById('salesIntegrationPreview');
  var publishButton = document.getElementById('salesIntegrationPublish');
  var statusBox = document.getElementById('salesIntegrationStatus');
  var resultsBox = document.getElementById('salesIntegrationResults');
  var useCurrentFileButton = document.getElementById('salesUseCurrentFile');
  var useTreatedBaseButton = document.getElementById('salesUseTreatedBase');
  var integrationPreview = null;
  var stagedTreatedRows = null;
  var stagedTreatedName = '';
  var stagedDiscardedRows = 0;
  var sourceMode = 'file';
  var productCategoryBySku = {};
  var integrationMonths = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  var outputHeaders = ['Marketplace', 'Marketplace venda', 'SKU', 'Id anúncio', 'Data', 'Categoria',
    'Sub Categoria', 'Valor', 'Tag', 'Descrição', 'Categoria2', 'Datatype', 'Record Date', 'Full Data'];
  var metricRules = [
    ['Unidades', '14.Quantidade', 'Quantidade', ['Unidades', 'Quantidade']],
    ['Faturamento', '13.Faturamento Bruto', 'Preço total com desconto', ['Faturamento', 'Preço total com desconto']],
    ['Imposto', '02.Imposto', 'Imposto', ['Imposto']],
    ['Comissão', '03.Despesas Marketplace', 'Comissão', ['Comissão']],
    ['Frete', '03.Despesas Marketplace', 'Tarifa de frete', ['Frete', 'Tarifa de frete']],
    ['Antecipa', '03.Despesas Marketplace', 'Shopee antecipa', ['Antecipa', 'Shopee antecipa'], true],
    ['rebate', '03.Despesas Marketplace', 'Rebate', ['rebate']],
    ['Cancelamento', '03.Despesas Marketplace', 'Cancelamento', ['Cancelamento', 'Cancelamentos e reembolsos (BRL)']],
    ['Desconto', '03.Despesas Marketplace', 'Desconto', ['Desconto'], true],
    ['Custo do produto', 'CMV', 'CMV', ['Custo do produto', 'CTP', 'CMV']],
    ['Gross margen', 'GM', 'Gross margen', ['Gross margen', 'Gross margin', 'GM']]
  ];

  function setStatus(title, message, type) {
    statusBox.className = 'sales-upload-card sales-upload-status' + (type ? ' ' + type : '');
    statusBox.innerHTML = '<strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(message) + '</p>';
  }

  function hasStagedTreatedRows() {
    return Array.isArray(stagedTreatedRows) && stagedTreatedRows.length > 1;
  }

  function selectSource(mode) {
    sourceMode = mode === 'treated' && hasStagedTreatedRows() ? 'treated' : 'file';
    useCurrentFileButton.classList.toggle('active', sourceMode === 'file');
    useTreatedBaseButton.classList.toggle('active', sourceMode === 'treated');
    integrationPreview = null;
    publishButton.disabled = true;
    resultsBox.hidden = true;
    if (sourceMode === 'treated') setStatus('Base tratada selecionada', stagedTreatedName + ' está pronta para leitura e conferência.' + (stagedDiscardedRows ? ' ' + stagedDiscardedRows + ' linha(s) de cabeçalho ou texto foram descartadas.' : ''), 'success');
    else setStatus('Subir arquivo atual', 'Selecione um arquivo do computador e clique em “Ler e conferir arquivo”.', '');
  }

  function normalized(value) {
    return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function stagedNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    return parseNumber(value);
  }

  async function loadProductCategories() {
    var response = await fetch('/api/product-master', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar as categorias dos SKUs.');
    var master = await response.json();
    var categoryNames = {};
    (master.categories || []).forEach(function (category) { categoryNames[category.id] = category.name; });
    productCategoryBySku = {};
    Object.keys(master.skus || {}).forEach(function (sku) {
      var item = master.skus[sku];
      if (item.categoryId && categoryNames[item.categoryId]) {
        var categoryName = categoryNames[item.categoryId];
        var normalizedSku = normalized(sku);
        productCategoryBySku[sku] = categoryName;
        productCategoryBySku[normalizedSku] = categoryName;
        if (!productCategoryBySku[normalizedSku.split('-')[0]]) productCategoryBySku[normalizedSku.split('-')[0]] = categoryName;
      }
    });
  }

  function categoryForSku(value) {
    var sku = String(value || '').trim();
    var normalizedSku = normalized(sku);
    return productCategoryBySku[sku] ||
      productCategoryBySku[normalizedSku] ||
      productCategoryBySku[normalizedSku.split('-')[0]] ||
      '';
  }

  function headerIndex(headers, name) {
    var key = normalized(name);
    return headers.findIndex(function (header) { return normalized(header) === key; });
  }

  function metricHeaderIndex(headers, rule) {
    var aliases = rule[3] || [rule[0]];
    for (var index = 0; index < aliases.length; index += 1) {
      var found = headerIndex(headers, aliases[index]);
      if (found >= 0) return found;
    }
    return -1;
  }

  function salesDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      var excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + Math.floor(value) * 86400000);
    }
    var text = String(value || '').trim();
    var br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
    var iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    var parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function isoDate(date) {
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(date.getUTCDate()).padStart(2, '0');
  }

  function cellNumber(value, label, rowNumber) {
    if (value === '' || value == null) return 0;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      throw new Error('Valor não numérico em "' + label + '", linha ' + rowNumber + '.');
    }
    var text = String(value).trim();
    // Nunca interpretar o próprio nome da coluna como valor financeiro.
    if (normalized(text) === normalized(label)) return 0;
    if (!text || /^(?:-|–|—|n\/?a|não se aplica)$/i.test(text) || /^R\$\s*(?:-|–|—)$/.test(text)) return 0;
    var parsed = parseNumber(value);
    if (!Number.isFinite(parsed)) throw new Error('Valor não numérico em "' + label + '", linha ' + rowNumber + '.');
    return parsed;
  }

  function buildIntegration(rows, fileName) {
    if (!Array.isArray(rows) || rows.length < 2) throw new Error('O arquivo não contém linhas de vendas.');
    var headers = rows[0].map(function (header) { return String(header || '').trim(); });
    var required = ['Marketplace', 'Marketplace venda', 'Data', 'SKU', 'Título do anúncio'];
    var missing = required.filter(function (name) { return headerIndex(headers, name) < 0; });
    metricRules.forEach(function (rule) {
      if (!rule[4] && metricHeaderIndex(headers, rule) < 0) missing.push(rule[0]);
    });
    if (missing.length) throw new Error('Colunas ausentes: ' + missing.join(', ') + '.');
    var indexes = {};
    required.forEach(function (name) { indexes[name] = headerIndex(headers, name); });
    metricRules.forEach(function (rule) { indexes[rule[0]] = metricHeaderIndex(headers, rule); });
    indexes.ad = ['# de anúncio', 'Id anúncio', 'ID do anuncio'].map(function (name) { return headerIndex(headers, name); })
      .find(function (index) { return index >= 0; });
    var currentYear = new Date().getFullYear();
    var groups = new Map();
    var sourceTotals = {};
    metricRules.forEach(function (rule) { sourceTotals[rule[1] + '|' + rule[2]] = 0; });
    var ignoredYears = new Set();
    var sourceRows = 0;

    rows.slice(1).forEach(function (row, rowIndex) {
      if (!row || !row.some(function (cell) { return String(cell || '').trim(); })) return;
      var matchingHeaderCells = row.reduce(function (total, cell, cellIndex) {
        return total + (normalized(cell) && normalized(cell) === normalized(headers[cellIndex]) ? 1 : 0);
      }, 0);
      if (matchingHeaderCells >= 2) return;
      // Alguns relatórios do Mercado Livre repetem o cabeçalho no meio dos dados.
      // Ele nunca deve ser interpretado como uma venda nem passar pela validação numérica.
      var repeatedHeader = normalized(row[indexes.SKU]) === 'sku' ||
        normalized(row[indexes.Data]) === 'data' ||
        metricRules.some(function (rule) {
          var metricIndex = indexes[rule[0]];
          if (metricIndex < 0) return false;
          var cell = normalized(row[metricIndex]);
          return cell === normalized(rule[0]) || (rule[3] || []).some(function (alias) { return cell === normalized(alias); });
        });
      if (repeatedHeader) return;
      var date = salesDate(row[indexes.Data]);
      if (!date) throw new Error('Data inválida na linha ' + (rowIndex + 2) + '.');
      if (date.getUTCFullYear() !== currentYear) {
        ignoredYears.add(date.getUTCFullYear());
        return;
      }
      sourceRows += 1;
      var dateIso = isoDate(date);
      var marketplace = String(row[indexes.Marketplace] || '').trim();
      var marketplaceSale = String(row[indexes['Marketplace venda']] || '').trim();
      var sku = String(row[indexes.SKU] || '').trim();
      var ad = indexes.ad >= 0 ? String(row[indexes.ad] || '').trim() : '';
      var description = String(row[indexes['Título do anúncio']] || '').trim();
      metricRules.forEach(function (rule) {
        var value = indexes[rule[0]] < 0 ? 0 : cellNumber(row[indexes[rule[0]]], rule[0], rowIndex + 2);
        // O anúncio e a empresa fazem parte da identidade da venda. Sem o anúncio,
        // dois anúncios do mesmo SKU no mesmo dia poderiam ser consolidados juntos.
        var key = [dateIso, sku, ad, marketplace, marketplaceSale, rule[1], rule[2]].join('\u001f');
        var group = groups.get(key) || {
          marketplace: marketplace, marketplaceSale: marketplaceSale, sku: sku, ad: ad, date: dateIso,
          category: rule[1], subcategory: rule[2], value: 0, description: description
        };
        group.value += value;
        groups.set(key, group);
        sourceTotals[rule[1] + '|' + rule[2]] += value;
      });
    });

    var generatedAt = new Date().toISOString();
    var generatedRows = Array.from(groups.values()).map(function (item) {
      return [item.marketplace, item.marketplaceSale, item.sku, item.ad, item.date, item.category,
        item.subcategory, item.value, '', item.description, categoryForSku(item.sku), 'Actual', generatedAt, item.date];
    });
    generatedRows.sort(function (a, b) {
      return String(a[4]).localeCompare(String(b[4])) || String(a[2]).localeCompare(String(b[2])) ||
        String(a[5]).localeCompare(String(b[5])) || String(a[6]).localeCompare(String(b[6]));
    });
    var byMonth = {};
    generatedRows.forEach(function (row) {
      var month = String(Number(String(row[4]).slice(5, 7)));
      if (!byMonth[month]) byMonth[month] = [outputHeaders];
      byMonth[month].push(row);
    });
    var generatedTotals = {};
    metricRules.forEach(function (rule) { generatedTotals[rule[1] + '|' + rule[2]] = 0; });
    generatedRows.forEach(function (row) { generatedTotals[row[5] + '|' + row[6]] += Number(row[7]) || 0; });
    var checks = [
      ['Faturamento', ['13.Faturamento Bruto|Preço total com desconto']],
      ['Unidades', ['14.Quantidade|Quantidade']],
      ['Imposto', ['02.Imposto|Imposto']],
      ['CMV', ['CMV|CMV']],
      ['GM', ['GM|Gross margen']],
      ['Despesas Marketplace', metricRules.filter(function (rule) { return rule[1] === '03.Despesas Marketplace'; })
        .map(function (rule) { return rule[1] + '|' + rule[2]; })]
    ].map(function (check) {
      var source = check[1].reduce(function (sum, key) { return sum + (sourceTotals[key] || 0); }, 0);
      var generated = check[1].reduce(function (sum, key) { return sum + (generatedTotals[key] || 0); }, 0);
      return { label: check[0], source: source, generated: generated, difference: generated - source };
    });
    return {
      fileName: fileName, sourceRows: sourceRows, generatedRows: generatedRows, byMonth: byMonth, checks: checks,
      ignoredYears: Array.from(ignoredYears).sort(), currentYear: currentYear
    };
  }

  function renderPreview(preview) {
    var allValid = preview.checks.every(function (check) { return Math.abs(check.difference) <= .01; });
    var monthLabels = Object.keys(preview.byMonth).sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (month) { return integrationMonths[Number(month) - 1] || month; });
    statusBox.className = 'sales-upload-card sales-upload-status ' + (allValid ? 'success' : 'error');
    statusBox.innerHTML = '<strong>' + (allValid ? 'Arquivo conferido e pronto' : 'Diferenças encontradas') + '</strong>' +
      '<p>' + escapeHtml(preview.fileName) + '</p><div class="sales-upload-metrics">' +
      '<div class="sales-upload-metric"><span>Vendas lidas</span><strong>' + preview.sourceRows.toLocaleString('pt-BR') + '</strong></div>' +
      '<div class="sales-upload-metric"><span>Linhas geradas</span><strong>' + preview.generatedRows.length.toLocaleString('pt-BR') + '</strong></div>' +
      '<div class="sales-upload-metric"><span>Ano publicado</span><strong>' + preview.currentYear + '</strong></div>' +
      '<div class="sales-upload-metric"><span>Meses realizados</span><strong>' + (monthLabels.join(', ') || 'Nenhum') + '</strong></div></div>';
    resultsBox.hidden = false;
    resultsBox.innerHTML = '<strong>Conferência obrigatória</strong><table class="sales-upload-checks"><thead><tr><th>Métrica</th><th>Origem</th><th>Base gerada</th><th>Diferença</th></tr></thead><tbody>' +
      preview.checks.map(function (check) {
        var ok = Math.abs(check.difference) <= .01;
        return '<tr><td>' + escapeHtml(check.label) + '</td><td>' + formatIntegrationValue(check.source, check.label) +
          '</td><td>' + formatIntegrationValue(check.generated, check.label) + '</td><td class="' +
          (ok ? 'sales-upload-ok' : 'sales-upload-fail') + '">' + formatIntegrationValue(check.difference, check.label) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (preview.ignoredYears.length ? '<p>O histórico de ' + escapeHtml(preview.ignoredYears.join(', ')) +
        ' foi lido, mas não será publicado porque o dashboard atual trabalha com ' + preview.currentYear + '.</p>' : '');
    publishButton.disabled = !allValid || !Object.keys(preview.byMonth).length;
  }

  function formatIntegrationValue(value, label) {
    return label === 'Unidades' ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value) :
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  function csvBlob(rows) {
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var text = String(cell == null ? '' : cell);
        return '"' + text.replace(/"/g, '""') + '"';
      }).join(';');
    }).join('\r\n');
    return new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  }

  async function publishIntegration(passwordOverride, mergeChannel) {
    var password = typeof passwordOverride === 'string' ? passwordOverride : passwordInput.value;
    var shouldMergeChannel = mergeChannel !== false;
    if (!password) {
      setStatus('Informe a senha', 'A senha administrativa é necessária para publicar as bases mensais.', 'error');
      return;
    }
    if (!integrationPreview) return;
    var monthKeys = Object.keys(integrationPreview.byMonth).sort(function (a, b) { return Number(a) - Number(b); });
    publishButton.disabled = true;
    previewButton.disabled = true;
    try {
      for (var index = 0; index < monthKeys.length; index += 1) {
        var month = monthKeys[index];
        var monthRows = integrationPreview.byMonth[month];
        if (shouldMergeChannel && typeof loadSalesHistoryRowsByMonth === 'function') {
          await loadSalesHistoryRowsByMonth();
          var existing = dashboardState.salesHistoryRowsByMonth && dashboardState.salesHistoryRowsByMonth[month];
          if (existing && Array.isArray(existing.dataRows) && existing.dataRows.length) {
            var existingHeaders = existing.headers || outputHeaders;
            var marketplaceIndex = headerIndex(existingHeaders, 'Marketplace');
            var saleIndex = headerIndex(existingHeaders, 'Marketplace venda');
            var datatypeIndex = headerIndex(existingHeaders, 'Datatype');
            var targetMarketplace = String(monthRows[1] && monthRows[1][0] || '');
            var targetSale = String(monthRows[1] && monthRows[1][1] || '');
            var preserved = existing.dataRows.filter(function (row) {
              var sameChannel = normalized(row[marketplaceIndex]) === normalized(targetMarketplace) && normalized(row[saleIndex]) === normalized(targetSale);
              var actual = datatypeIndex < 0 || normalized(row[datatypeIndex]) === 'actual';
              return !(sameChannel && actual);
            });
            monthRows = [outputHeaders].concat(preserved, monthRows.slice(1));
          }
        }
        setStatus('Publicando bases', 'Mês ' + (index + 1) + ' de ' + monthKeys.length + ': ' +
          (integrationMonths[Number(month) - 1] || month) + '.', '');
        var fileName = 'Base_de_Dados_' + integrationPreview.currentYear + '_' + String(month).padStart(2, '0') + '.csv';
        var response = await fetchWithTimeout('/api/upload-base', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream', 'X-Admin-Password': password,
            'X-File-Name': encodeURIComponent(fileName), 'X-Base-Month': month
          },
          body: csvBlob(monthRows)
        }, LARGE_UPLOAD_TIMEOUT_MS);
        if (!response.ok) throw new Error(await response.text() || 'Falha ao publicar ' + fileName + '.');
        dashboardState.monthMetadata[month] = await response.json();
        dashboardState.monthMetadata[month] = await publishProcessedRows(password, month, monthRows);
      }
      dashboardState.salesHistoryRowsByMonth = {};
      dashboardState.renderedPanels = {};
      var lastMonth = monthKeys[monthKeys.length - 1];
      dashboardState.activeMonth = lastMonth;
      var lastRows = await loadRowsFromMetadata(dashboardState.monthMetadata[lastMonth]);
      processRows(lastRows, 'Base consolidada · ' + integrationPreview.fileName, true);
      renderMonthTabs();
      renderLastUpdate(dashboardState.monthMetadata[lastMonth]);
      setStatus('Publicação concluída', monthKeys.length + ' meses atualizados sem duplicação. A Base de Dados e os painéis já podem ler os novos valores.', 'success');
      return true;
    } catch (error) {
      setStatus('Não foi possível publicar', error.message || 'Erro durante a integração.', 'error');
      return false;
    } finally {
      previewButton.disabled = false;
      publishButton.disabled = false;
    }
  }

  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) selectSource('file');
  });

  useCurrentFileButton.addEventListener('click', function () { selectSource('file'); });
  useTreatedBaseButton.addEventListener('click', function () {
    if (!hasStagedTreatedRows()) {
      selectSource('file');
      setStatus('Nenhuma base tratada disponível', 'Abra o Tratador de Vendas, trate um relatório e clique em “Enviar para Subir Base de Vendas”.', '');
      return;
    }
    selectSource('treated');
  });

  previewButton.addEventListener('click', async function () {
    var file = fileInput.files[0];
    if (sourceMode === 'file' && !file) {
      setStatus('Selecione um arquivo', 'Escolha o arquivo RESUMO_VENDAS_E_VARIAÇÃO antes de continuar.', 'error');
      return;
    }
    try {
      if (sourceMode === 'file') validateFile(file);
      previewButton.disabled = true;
      publishButton.disabled = true;
      setStatus('Lendo arquivo', 'Convertendo as vendas para o formato da Base de Dados.', '');
      await loadProductCategories();
      if (sourceMode === 'treated' && !hasStagedTreatedRows()) {
        selectSource('file');
        throw new Error('Nenhuma base tratada está disponível. Trate um relatório antes de continuar.');
      }
      integrationPreview = sourceMode === 'treated' ? buildIntegration(stagedTreatedRows, stagedTreatedName) : buildIntegration(await readRowsFromFile(file), file.name);
      renderPreview(integrationPreview);
    } catch (error) {
      integrationPreview = null;
      resultsBox.hidden = true;
      setStatus('Arquivo inválido', error.message || 'Não foi possível ler o arquivo.', 'error');
    } finally {
      previewButton.disabled = false;
    }
  });

  publishButton.addEventListener('click', function () { publishIntegration(undefined, true); });
  window.salesBaseIntegration = {
    stageTreatedRows: function (rows, fileName) {
      stagedDiscardedRows = 0;
      if (Array.isArray(rows) && rows.length) {
        var stageHeaders = rows[0].map(function (header) { return String(header || '').trim(); });
        var stageMetricIndexes = metricRules.map(function (rule) { return metricHeaderIndex(stageHeaders, rule); }).filter(function (index) { return index >= 0; });
        var stageUnitsIndex = headerIndex(stageHeaders, 'Unidades');
        var stageTitleIndex = headerIndex(stageHeaders, 'Título do anúncio');
        var stagePriceIndex = headerIndex(stageHeaders, 'Preço unitário de venda do anúncio (BRL)');
        var cleanRows = rows.slice(1).filter(function (row) {
          var repeated = row.reduce(function (total, cell, index) { return total + (normalized(cell) && normalized(cell) === normalized(stageHeaders[index]) ? 1 : 0); }, 0) >= 2;
          if (repeated) { stagedDiscardedRows += 1; return false; }
          var numeric = stageMetricIndexes.every(function (index) {
            var value = row[index];
            if (value === '' || value == null) return true;
            return Number.isFinite(stagedNumber(value));
          });
          var hasSaleFields = stageUnitsIndex < 0 || stageTitleIndex < 0 || stagePriceIndex < 0 ||
            (stagedNumber(row[stageUnitsIndex]) > 0 && String(row[stageTitleIndex] || '').trim() && stagedNumber(row[stagePriceIndex]) > 0);
          numeric = numeric && hasSaleFields;
          if (!numeric) stagedDiscardedRows += 1;
          return numeric;
        });
        stagedTreatedRows = cleanRows.length ? [stageHeaders].concat(cleanRows) : null;
      } else stagedTreatedRows = null;
      stagedTreatedName = fileName || 'RESUMO VENDAS E VARIAÇÃO tratado';
      useTreatedBaseButton.disabled = !hasStagedTreatedRows();
      if (hasStagedTreatedRows()) {
        selectSource('treated');
        return true;
      }
      selectSource('file');
      setStatus('Nenhuma venda válida foi preparada', 'Volte ao Tratador de Vendas e confira o relatório antes de enviar novamente.', 'error');
      return false;
    },
    prepareTreatedRows: async function (rows, fileName) {
      await loadProductCategories();
      if (Array.isArray(rows) && rows.length > 1) {
        var treatedHeaders = rows[0] || [];
        var treatedUnitsIndex = headerIndex(treatedHeaders, 'Unidades');
        var treatedSkuIndex = headerIndex(treatedHeaders, 'SKU');
        rows = rows.filter(function (row, index) {
          if (index === 0) return true;
          return !(treatedUnitsIndex >= 0 && normalized(row[treatedUnitsIndex]) === 'unidades') &&
            !(treatedSkuIndex >= 0 && normalized(row[treatedSkuIndex]) === 'sku');
        });
      }
      integrationPreview = buildIntegration(rows, (fileName || 'Relatório tratado') + ' · conversor v13');
      renderPreview(integrationPreview);
      return integrationPreview;
    },
    publishPrepared: function (password, mergeChannel) { return publishIntegration(password, mergeChannel); },
    hasPreparedData: function () { return !!integrationPreview; }
  };
})();
