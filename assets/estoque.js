(function () {
  'use strict';

  var entriesContainer = document.getElementById('inventoryEntriesContainer');
  var averageContainer = document.getElementById('inventoryAverageContainer');
  if (!entriesContainer || !averageContainer) return;

  var inventory = { entries: [], links: {} };
  var master = { categories: [], skus: {} };
  var loaded = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function number(value) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
  }

  function monthKey(date) {
    return String(date || '').slice(0, 7);
  }

  function currentMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  async function loadData(force) {
    if (loaded && !force) return;
    var responses = await Promise.all([
      fetch('/api/inventory', { cache: 'no-store' }),
      fetch('/api/product-master', { cache: 'no-store' })
    ]);
    if (!responses[0].ok || !responses[1].ok) throw new Error('Não foi possível carregar o estoque.');
    inventory = await responses[0].json();
    master = await responses[1].json();
    loaded = true;
  }

  async function updateInventory(payload) {
    var response = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o estoque.');
    inventory = result;
    return result;
  }

  function skuOptions() {
    return Object.values(master.skus || {}).sort(function (a, b) {
      return String(a.sku).localeCompare(String(b.sku), 'pt-BR');
    }).map(function (item) {
      return '<option value="' + escapeHtml(item.sku) + '">' + escapeHtml(item.description || item.marketplace || '') + '</option>';
    }).join('');
  }

  function categoryName(item) {
    var category = (master.categories || []).find(function (candidate) {
      return candidate.id === (item && item.categoryId);
    });
    return category ? category.name : 'Não categorizado';
  }

  function renderEntries() {
    var entries = (inventory.entries || []).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt));
    });
    entriesContainer.innerHTML = '<div class="inventory-page">' +
      '<section class="inventory-hero"><div class="inventory-title"><strong>Entradas de Estoque</strong>' +
      '<span>Registre cada entrada e vincule o SKU do fornecedor ao SKU utilizado nas vendas.</span></div>' +
      '<span class="inventory-link">' + entries.length.toLocaleString('pt-BR') + ' lançamentos</span></section>' +
      '<section class="inventory-card"><form class="inventory-form" id="inventoryEntryForm">' +
      '<div class="inventory-field"><label for="inventoryInvoice">NF</label><input id="inventoryInvoice" required placeholder="Número da nota"></div>' +
      '<div class="inventory-field"><label for="inventorySupplier">Fornecedor</label><input id="inventorySupplier" required placeholder="Fornecedor"></div>' +
      '<div class="inventory-field"><label for="inventoryDate">Data</label><input id="inventoryDate" type="date" required value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
      '<div class="inventory-field"><label for="inventoryInputSku">SKU de entrada</label><input id="inventoryInputSku" required list="inventoryInputSkuList" autocomplete="off" placeholder="Pesquise ou digite"><datalist id="inventoryInputSkuList">' +
      Object.keys(inventory.links || {}).sort().map(function (sku) { return '<option value="' + escapeHtml(sku) + '"></option>'; }).join('') + '</datalist></div>' +
      '<div class="inventory-field wide"><label for="inventorySalesSku">Vincular ao SKU de venda</label><input id="inventorySalesSku" required list="inventorySalesSkuList" autocomplete="off" placeholder="Pesquise pelo SKU ou descrição"><datalist id="inventorySalesSkuList">' +
      skuOptions() + '</datalist></div>' +
      '<div class="inventory-field"><label for="inventoryQuantity">Quantidade</label><input id="inventoryQuantity" type="number" min="0.001" step="0.001" required></div>' +
      '<div class="inventory-field"><label for="inventoryUnitCost">Custo unitário</label><input id="inventoryUnitCost" type="number" min="0" step="0.01" required></div>' +
      '<div class="inventory-field"><label for="inventoryTotal">Valor total</label><input id="inventoryTotal" readonly value="' + money(0) + '"></div>' +
      '<div class="inventory-actions"><button class="inventory-button primary" type="submit">Adicionar entrada</button></div></form>' +
      '<div class="inventory-status" id="inventoryStatus"></div></section>' +
      '<section class="inventory-card"><div class="inventory-card-head"><h3>Histórico de entradas</h3><span class="inventory-note">Entradas mais recentes primeiro</span></div>' +
      '<div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th>NF</th><th>Fornecedor</th><th>Data</th><th>SKU entrada</th><th>SKU venda</th><th>Quantidade</th><th>Custo unitário</th><th>Total</th><th></th></tr></thead><tbody>' +
      (entries.length ? entries.map(function (entry) {
        return '<tr><td>' + escapeHtml(entry.invoice) + '</td><td>' + escapeHtml(entry.supplier) + '</td><td>' +
          new Date(entry.date + 'T00:00:00').toLocaleDateString('pt-BR') + '</td><td>' + escapeHtml(entry.inputSku) +
          '</td><td><span class="inventory-link">' + escapeHtml(entry.salesSku) + '</span></td><td class="number">' +
          number(entry.quantity) + '</td><td class="number">' + money(entry.unitCost) + '</td><td class="number">' +
          money(entry.totalCost) + '</td><td><button class="inventory-button danger inventory-delete" type="button" data-id="' +
          escapeHtml(entry.id) + '">Excluir</button></td></tr>';
      }).join('') : '<tr><td colspan="9">Nenhuma entrada cadastrada.</td></tr>') + '</tbody></table></div></section></div>';

    var quantityInput = document.getElementById('inventoryQuantity');
    var costInput = document.getElementById('inventoryUnitCost');
    var totalInput = document.getElementById('inventoryTotal');
    var inputSku = document.getElementById('inventoryInputSku');
    var salesSku = document.getElementById('inventorySalesSku');
    function updateTotal() {
      totalInput.value = money((Number(quantityInput.value) || 0) * (Number(costInput.value) || 0));
    }
    quantityInput.addEventListener('input', updateTotal);
    costInput.addEventListener('input', updateTotal);
    inputSku.addEventListener('input', function () {
      var linked = (inventory.links || {})[inputSku.value.trim()];
      if (linked) salesSku.value = linked;
    });
    document.getElementById('inventoryEntryForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var status = document.getElementById('inventoryStatus');
      status.className = 'inventory-status';
      status.textContent = 'Salvando entrada...';
      try {
        await updateInventory({
          action: 'add-entry',
          invoice: document.getElementById('inventoryInvoice').value,
          supplier: document.getElementById('inventorySupplier').value,
          date: document.getElementById('inventoryDate').value,
          inputSku: inputSku.value,
          salesSku: salesSku.value,
          quantity: quantityInput.value,
          unitCost: costInput.value
        });
        renderEntries();
        document.getElementById('inventoryStatus').className = 'inventory-status success';
        document.getElementById('inventoryStatus').textContent = 'Entrada adicionada e vínculo de SKU salvo.';
      } catch (error) {
        status.className = 'inventory-status error';
        status.textContent = error.message;
      }
    });
    entriesContainer.querySelectorAll('.inventory-delete').forEach(function (button) {
      button.addEventListener('click', async function () {
        try {
          await updateInventory({ action: 'delete-entry', id: button.dataset.id });
          renderEntries();
        } catch (error) {
          var status = document.getElementById('inventoryStatus');
          status.className = 'inventory-status error';
          status.textContent = error.message;
        }
      });
    });
  }

  function buildAverageRows(selectedMonth) {
    var groups = {};
    (inventory.entries || []).filter(function (entry) {
      return monthKey(entry.date) === selectedMonth;
    }).forEach(function (entry) {
      var key = entry.salesSku;
      var group = groups[key] || { sku: key, quantity: 0, total: 0, entries: 0 };
      group.quantity += Number(entry.quantity) || 0;
      group.total += Number(entry.totalCost) || 0;
      group.entries += 1;
      groups[key] = group;
    });
    return Object.values(groups).map(function (group) {
      var product = (master.skus || {})[group.sku] || {};
      group.averageCost = group.quantity ? group.total / group.quantity : 0;
      group.description = product.description || '';
      group.marketplace = product.marketplace || '';
      group.category = categoryName(product);
      return group;
    }).sort(function (a, b) {
      return a.category.localeCompare(b.category, 'pt-BR') || a.sku.localeCompare(b.sku, 'pt-BR');
    });
  }

  function exportAverageCsv(rows, selectedMonth) {
    var header = ['Mês', 'Categoria', 'SKU', 'Descrição', 'Quantidade entrada', 'Custo total', 'Custo médio'];
    var csv = [header].concat(rows.map(function (row) {
      return [selectedMonth, row.category, row.sku, row.description, row.quantity, row.total, row.averageCost];
    })).map(function (cells) {
      return cells.map(function (cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'custo-medio-' + selectedMonth + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function renderAverage(selectedMonth) {
    var month = selectedMonth || currentMonth();
    var rows = buildAverageRows(month);
    var totalQuantity = rows.reduce(function (total, row) { return total + row.quantity; }, 0);
    var totalCost = rows.reduce(function (total, row) { return total + row.total; }, 0);
    var months = Array.from(new Set((inventory.entries || []).map(function (entry) { return monthKey(entry.date); }).filter(Boolean)));
    if (!months.includes(month)) months.push(month);
    months.sort().reverse();
    averageContainer.innerHTML = '<div class="inventory-page"><section class="inventory-hero"><div class="inventory-title">' +
      '<strong>Custo Médio de Estoque</strong><span>Custo médio ponderado pelas quantidades de entrada em cada mês.</span></div>' +
      '<div class="inventory-toolbar"><div class="inventory-field"><label for="inventoryAverageMonth">Mês</label><input id="inventoryAverageMonth" type="month" value="' +
      escapeHtml(month) + '"></div><button class="inventory-button primary" id="inventoryExport" type="button">Extrair CSV</button></div></section>' +
      '<div class="inventory-stats"><div class="inventory-stat"><strong>' + rows.length.toLocaleString('pt-BR') +
      '</strong><span>SKUs com entrada</span></div><div class="inventory-stat"><strong>' + number(totalQuantity) +
      '</strong><span>Unidades recebidas</span></div><div class="inventory-stat"><strong>' + money(totalCost) +
      '</strong><span>Custo total de entrada</span></div></div>' +
      '<section class="inventory-card"><div class="inventory-card-head"><h3>Custo médio por SKU</h3><span class="inventory-note">' +
      escapeHtml(month.split('-').reverse().join('/')) + '</span></div><div class="inventory-table-wrap"><table class="inventory-table"><thead><tr>' +
      '<th>Categoria</th><th>SKU venda</th><th>Descrição</th><th>Quantidade</th><th>Entradas</th><th>Custo total</th><th>Custo médio</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (row) {
        return '<tr><td>' + escapeHtml(row.category) + '</td><td><span class="inventory-link">' + escapeHtml(row.sku) +
          '</span></td><td>' + escapeHtml(row.description || '—') + '</td><td class="number">' + number(row.quantity) +
          '</td><td class="number">' + row.entries.toLocaleString('pt-BR') + '</td><td class="number">' + money(row.total) +
          '</td><td class="number"><strong>' + money(row.averageCost) + '</strong></td></tr>';
      }).join('') : '<tr><td colspan="7">Nenhuma entrada neste mês.</td></tr>') + '</tbody></table></div></section></div>';
    document.getElementById('inventoryAverageMonth').addEventListener('change', function () { renderAverage(this.value); });
    document.getElementById('inventoryExport').addEventListener('click', function () { exportAverageCsv(rows, month); });
  }

  async function openInventoryPanel(panelId) {
    try {
      await loadData(true);
      if (panelId === 'inventoryEntriesPanel') renderEntries();
      if (panelId === 'inventoryAveragePanel') renderAverage();
    } catch (error) {
      (panelId === 'inventoryEntriesPanel' ? entriesContainer : averageContainer).innerHTML =
        '<div class="empty-table">' + escapeHtml(error.message) + '</div>';
    }
  }

  document.querySelectorAll('[data-tab="inventoryEntriesPanel"],[data-tab="inventoryAveragePanel"]').forEach(function (button) {
    button.addEventListener('click', function () { openInventoryPanel(button.dataset.tab); });
  });
}());
