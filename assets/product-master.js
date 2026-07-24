(function () {
  'use strict';

  var categoriesContainer = document.getElementById('productCategoriesContainer');
  var skuContainer = document.getElementById('skuCatalogContainer');
  if (!categoriesContainer || !skuContainer) return;

  var master = { categories: [], skus: {} };
  var loaded = false;
  var searchText = '';
  var pendingOnly = false;

  function escapeValue(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  async function loadMaster(force) {
    if (loaded && !force) return master;
    var response = await fetch('/api/product-master', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o cadastro.');
    master = await response.json();
    loaded = true;
    return master;
  }

  async function updateMaster(payload) {
    var response = await fetch('/api/product-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    master = result;
    loaded = true;
    return master;
  }

  function renderCategories() {
    var categories = master.categories || [];
    categoriesContainer.innerHTML = '<div class="product-master-page">' +
      '<section class="product-master-toolbar"><div class="product-master-title"><strong>Categorias de Produto</strong>' +
      '<span>Cadastre uma vez e selecione a mesma categoria nos SKUs. Nomes equivalentes não podem ser duplicados.</span></div>' +
      '<form class="product-master-form" id="categoryForm"><div class="product-master-field"><label for="newProductCategory">Nova categoria</label>' +
      '<input id="newProductCategory" required maxlength="80" placeholder="Ex.: Higiene e Limpeza"></div>' +
      '<button class="product-master-button" type="submit">Cadastrar categoria</button></form></section>' +
      '<div class="product-master-status" id="categoryStatus"></div><section class="product-master-card"><div class="product-master-stats">' +
      '<div class="product-master-stat"><strong>' + categories.length.toLocaleString('pt-BR') + '</strong><span>Categorias cadastradas</span></div></div>' +
      '<div class="product-master-table-wrap"><table class="product-master-table"><thead><tr><th>Categoria oficial</th><th>SKUs vinculados</th><th>Cadastrada em</th></tr></thead><tbody>' +
      (categories.length ? categories.map(function (category) {
        var count = Object.values(master.skus || {}).filter(function (sku) { return sku.categoryId === category.id; }).length;
        return '<tr><td>' + escapeValue(category.name) + '</td><td>' + count.toLocaleString('pt-BR') + '</td><td>' +
          new Date(category.createdAt).toLocaleDateString('pt-BR') + '</td></tr>';
      }).join('') : '<tr><td colspan="3">Nenhuma categoria cadastrada.</td></tr>') + '</tbody></table></div></section></div>';

    document.getElementById('categoryForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var status = document.getElementById('categoryStatus');
      status.className = 'product-master-status';
      status.textContent = 'Salvando...';
      try {
        await updateMaster({ action: 'add-category', name: document.getElementById('newProductCategory').value });
        renderCategories();
        document.getElementById('categoryStatus').className = 'product-master-status success';
        document.getElementById('categoryStatus').textContent = 'Categoria cadastrada.';
      } catch (error) {
        status.className = 'product-master-status error';
        status.textContent = error.message;
      }
    });
  }

  function getVisibleSkus() {
    return Object.values(master.skus || {}).filter(function (item) {
      var matches = !searchText || [item.sku, item.description, item.marketplace].join(' ').toLowerCase().includes(searchText);
      return matches && (!pendingOnly || !item.categoryId);
    }).sort(function (a, b) {
      return Number(Boolean(a.categoryId)) - Number(Boolean(b.categoryId)) || a.sku.localeCompare(b.sku, 'pt-BR');
    });
  }

  function categoryOptions(selected) {
    return '<option value="">Selecione...</option>' + (master.categories || []).map(function (category) {
      return '<option value="' + escapeValue(category.id) + '"' + (category.id === selected ? ' selected' : '') + '>' +
        escapeValue(category.name) + '</option>';
    }).join('');
  }

  function renderSkus() {
    var all = Object.values(master.skus || {});
    var visible = getVisibleSkus();
    var pending = all.filter(function (item) { return !item.categoryId; }).length;
    skuContainer.innerHTML = '<div class="product-master-page"><section class="product-master-toolbar"><div class="product-master-title">' +
      '<strong>Cadastro de SKU</strong><span>SKUs antigos permanecem cadastrados. Novos SKUs entram como pendentes até receberem uma categoria oficial.</span></div>' +
      '<div class="product-master-form"><div class="product-master-field"><label for="skuSearch">Buscar SKU ou produto</label>' +
      '<input id="skuSearch" value="' + escapeValue(searchText) + '" placeholder="Digite para filtrar"></div>' +
      '<div class="product-master-field"><label for="skuPendingFilter">Situação</label><select id="skuPendingFilter"><option value="">Todos</option>' +
      '<option value="pending"' + (pendingOnly ? ' selected' : '') + '>Somente pendentes</option></select></div></section><div class="product-master-status" id="skuStatus"></div>' +
      '<section class="product-master-card"><div class="product-master-stats"><div class="product-master-stat"><strong>' +
      all.length.toLocaleString('pt-BR') + '</strong><span>SKUs cadastrados</span></div><div class="product-master-stat"><strong>' +
      pending.toLocaleString('pt-BR') + '</strong><span>Pendentes de categoria</span></div><div class="product-master-stat"><strong>' +
      (all.length - pending).toLocaleString('pt-BR') + '</strong><span>Categorizados</span></div></div>' +
      '<p class="product-master-note">Exibindo ' + visible.length.toLocaleString('pt-BR') + ' SKUs.</p>' +
      '<div class="product-master-table-wrap"><table class="product-master-table"><thead><tr><th>SKU</th><th>Descrição</th><th>Marketplace</th><th>Categoria oficial</th><th>Status</th></tr></thead><tbody>' +
      visible.map(function (item) {
        return '<tr><td>' + escapeValue(item.sku) + '</td><td>' + escapeValue(item.description || '—') + '</td><td>' +
          escapeValue(item.marketplace || '—') + '</td><td><select class="sku-category-select" data-sku="' + escapeValue(item.sku) + '">' +
          categoryOptions(item.categoryId) + '</select></td><td class="' + (item.categoryId ? 'sku-saved' : 'sku-pending') + '">' +
          (item.categoryId ? 'Categorizado' : 'Pendente') + '</td></tr>';
      }).join('') + '</tbody></table></div></section></div>';

    document.getElementById('skuSearch').addEventListener('input', function () {
      searchText = this.value.trim().toLowerCase();
      renderSkus();
      var input = document.getElementById('skuSearch');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    document.getElementById('skuPendingFilter').addEventListener('change', function () {
      pendingOnly = this.value === 'pending';
      renderSkus();
    });
    skuContainer.querySelectorAll('.sku-category-select').forEach(function (select) {
      select.addEventListener('change', async function () {
        var status = document.getElementById('skuStatus');
        status.textContent = 'Salvando ' + this.dataset.sku + '...';
        try {
          await updateMaster({ action: 'assign-sku', sku: this.dataset.sku, categoryId: this.value });
          renderSkus();
          document.getElementById('skuStatus').className = 'product-master-status success';
          document.getElementById('skuStatus').textContent = 'Categoria do SKU salva.';
        } catch (error) {
          status.className = 'product-master-status error';
          status.textContent = error.message;
        }
      });
    });
  }

  async function openPanel(panelId) {
    try {
      await loadMaster(true);
      if (panelId === 'productCategoriesPanel') renderCategories();
      if (panelId === 'skuCatalogPanel') renderSkus();
    } catch (error) {
      var container = panelId === 'productCategoriesPanel' ? categoriesContainer : skuContainer;
      container.innerHTML = '<div class="empty-table">' + escapeValue(error.message) + '</div>';
    }
  }

  document.querySelectorAll('[data-tab="productCategoriesPanel"],[data-tab="skuCatalogPanel"]').forEach(function (button) {
    button.addEventListener('click', function () { openPanel(button.dataset.tab); });
  });
}());
