(function () {
  'use strict';

  var state = { companies: [], counterparties: [], payables: [], receivables: [], bankAccounts: [], paymentMethods: [] };
  var options = [];
  var companyFilters = { payable: '', receivable: '' };
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function number(value) {
    var text = String(value == null ? '' : value).trim().replace(/[R$\s]/g, '');
    if (text.indexOf(',') >= 0) text = text.replace(/\./g, '').replace(',', '.');
    var parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function api(payload) {
    var response = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    state = result;
    if (Array.isArray(result.financialOptions) && result.financialOptions.length) options = result.financialOptions;
    renderAll();
    return result;
  }

  function classifications() {
    return Array.from(new Set(options.map(function (item) { return item.classification; }))).sort();
  }

  function optionHtml(values, selected) {
    return '<option value="">Selecione</option>' + values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>';
    }).join('');
  }

  function registryOptions(items, selected) {
    return '<option value="">Selecione</option>' + (items || []).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' + esc(item.name) + '</option>';
    }).join('');
  }

  function companyOptions(selected, includeAll) {
    var first = includeAll ? '<option value="">Todas as empresas</option>' : '<option value="">Selecione a empresa</option>';
    return first + (state.companies || []).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' + esc(item.name) + '</option>';
    }).join('');
  }

  function accountForm(type) {
    var noun = type === 'payable' ? 'Fornecedor' : 'Cliente';
    var people = state.counterparties.filter(function (item) {
      return item.kind === 'both' || item.kind === (type === 'payable' ? 'supplier' : 'client');
    });
    var payableFields = type === 'payable' ?
      '<label>Forma de pagamento<select name="paymentMethodId">' + registryOptions(state.paymentMethods) + '</select></label>' +
      '<label>Banco / Conta<select name="bankAccountId">' + registryOptions(state.bankAccounts) + '</select></label>' +
      '<label>Número de parcelas<input name="installmentCount" type="number" min="1" max="120" value="1" required></label>' :
      '<label>Conta<input name="account" placeholder="Banco / Caixa"></label>';
    return '<form class="accounts-form" data-account-form="' + type + '">' +
      '<label>Empresa<select name="companyId" required>' + companyOptions('', false) + '</select></label>' +
      '<label>Descrição<input name="description" required></label>' +
      '<label>' + noun + '<select name="counterpartyId"><option value="">Selecione</option>' + people.map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label>Vencimento<input name="dueDate" type="date" required></label>' +
      '<label>Competência<input name="competenceDate" type="date"></label>' +
      '<label>Valor<input name="amount" inputmode="decimal" required></label>' +
      '<label>Classificação<select name="classification">' + optionHtml(classifications()) + '</select></label>' +
      '<label>Categoria<select name="category"><option value="">Selecione a classificação</option></select></label>' +
      payableFields +
      '<label>Documento<input name="document"></label>' +
      '<label class="accounts-wide">Observações<input name="notes"></label>' +
      '<button class="accounts-primary" type="submit">Salvar título</button>' +
      '</form>';
  }

  function recordTable(type) {
    var rows = type === 'payable' ? state.payables : state.receivables;
    if (companyFilters[type]) rows = rows.filter(function (row) { return row.companyId === companyFilters[type]; });
    var people = {};
    state.counterparties.forEach(function (item) { people[item.id] = item.name; });
    var bankAccounts = {}; var paymentMethods = {};
    (state.bankAccounts || []).forEach(function (item) { bankAccounts[item.id] = item.name; });
    (state.paymentMethods || []).forEach(function (item) { paymentMethods[item.id] = item.name; });
    var companies = {}; (state.companies || []).forEach(function (item) { companies[item.id] = item.name; });
    return '<div class="accounts-table-wrap"><table class="accounts-table"><thead><tr><th>Empresa</th><th>Vencimento</th><th>Descrição</th><th>Cliente / Fornecedor</th><th>Classificação</th><th>Categoria</th>' +
      (type === 'payable' ? '<th>Parcela</th><th>Forma de pagamento</th><th>Banco / Conta</th>' : '') + '<th>Valor</th><th>Status</th><th>Ação</th></tr></thead><tbody>' +
      (rows.length ? rows.slice().sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); }).map(function (row) {
        return '<tr><td>' + esc(companies[row.companyId] || 'Sem empresa') + '</td><td>' + esc(row.dueDate.split('-').reverse().join('/')) + '</td><td>' + esc(row.description) +
          '</td><td>' + esc(people[row.counterpartyId] || 'Não informado') + '</td><td>' + esc(row.classification) +
          '</td><td>' + esc(row.category) + '</td>' + (type === 'payable' ? '<td>' + esc((row.installmentNumber || 1) + '/' + (row.installmentCount || 1)) + '</td><td>' +
          esc(paymentMethods[row.paymentMethodId] || 'Não informada') + '</td><td>' + esc(bankAccounts[row.bankAccountId] || row.account || 'Não informada') + '</td>' : '') +
          '<td>' + money.format(row.amount) + '</td><td><span class="accounts-status ' +
          row.status + '">' + (row.status === 'settled' ? (type === 'payable' ? 'Pago' : 'Recebido') : 'Em aberto') +
          '</span></td><td><div class="accounts-actions">' + (row.status === 'settled' ? '' : '<button class="accounts-settle" data-settle="' + row.id +
          '" data-type="' + type + '">' + (type === 'payable' ? 'Dar baixa' : 'Receber') + '</button>') + '<button class="accounts-delete" data-delete="' + row.id +
          '" data-type="' + type + '">Excluir</button></div></td></tr>';
      }).join('') : '<tr><td colspan="' + (type === 'payable' ? '12' : '9') + '" class="accounts-empty">Nenhum título cadastrado.</td></tr>') +
      '</tbody></table></div>';
  }

  function configurationCard() {
    function cards(items, emptyText) {
      return items.length ? items.map(function (item) { return '<span class="accounts-config-item">' + esc(item.name) + '</span>'; }).join('') : '<span class="accounts-config-empty">' + emptyText + '</span>';
    }
    return '<section class="accounts-card accounts-config-card"><h3>Empresas identificadas nas vendas</h3><p>Lista atualizada automaticamente pela coluna Marketplace venda das bases publicadas. Não é necessário cadastrar manualmente.</p><div class="accounts-config-list">' + cards(state.companies || [], 'Publique uma Base de Vendas para identificar as empresas.') + '</div></section>' +
      '<section class="accounts-card accounts-config-card"><h3>Configurações de pagamento</h3><p>Cadastre uma vez para selecionar nos próximos lançamentos.</p>' +
      '<div class="accounts-config-grid"><div><form class="accounts-config-form" data-config-form="bankAccount"><label>Banco / Conta<input name="name" placeholder="Ex.: Itaú - Conta Corrente" required></label><button class="accounts-primary" type="submit">Adicionar conta</button></form><div class="accounts-config-list">' + cards(state.bankAccounts || [], 'Nenhuma conta cadastrada.') + '</div></div>' +
      '<div><form class="accounts-config-form" data-config-form="paymentMethod"><label>Forma de pagamento<input name="name" placeholder="Ex.: Boleto, PIX ou Cartão" required></label><button class="accounts-primary" type="submit">Adicionar forma</button></form><div class="accounts-config-list">' + cards(state.paymentMethods || [], 'Nenhuma forma cadastrada.') + '</div></div></div></section>';
  }

  function financialStructureCard() {
    var classificationRows = classifications().map(function (classification) {
      return '<form class="accounts-structure-row" data-classification-form><input type="hidden" name="previousName" value="' + esc(classification) + '"><input name="name" value="' + esc(classification) + '" required><button class="accounts-secondary" type="submit">Renomear classificação</button></form>';
    }).join('');
    var categoryRows = options.slice().sort(function (a, b) {
      return (a.classification + a.category).localeCompare(b.classification + b.category, 'pt-BR');
    }).map(function (item) {
      return '<form class="accounts-structure-row accounts-category-row" data-financial-option-form><input type="hidden" name="id" value="' + esc(item.id || '') + '"><input name="classification" value="' + esc(item.classification) + '" aria-label="Classificação" required><input name="category" value="' + esc(item.category) + '" aria-label="Categoria" required><button class="accounts-secondary" type="submit">Salvar</button></form>';
    }).join('');
    return '<section class="accounts-card accounts-structure-card"><h3>Classificações e categorias da DRE / Fluxo de Caixa</h3><p>As categorias ficam sempre vinculadas a uma classificação e são usadas nos dois relatórios.</p>' +
      '<form class="accounts-config-form accounts-new-option" data-financial-option-form><label>Classificação<input name="classification" placeholder="Ex.: Custo Fixo" required></label><label>Categoria<input name="category" placeholder="Ex.: Aluguel" required></label><button class="accounts-primary" type="submit">Adicionar categoria</button></form>' +
      '<div class="accounts-structure-grid"><div><h4>Editar classificações</h4>' + (classificationRows || '<span class="accounts-config-empty">Nenhuma classificação cadastrada.</span>') + '</div><div><h4>Editar categorias e vínculos</h4>' + (categoryRows || '<span class="accounts-config-empty">Nenhuma categoria cadastrada.</span>') + '</div></div></section>';
  }

  function renderAccounts(type) {
    var id = type === 'payable' ? 'payablesContainer' : 'receivablesContainer';
    var title = type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber';
    var container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = '<div class="accounts-shell"><div class="accounts-head"><div><h2>' + title +
      '</h2><p>Cadastre manualmente ou importe uma planilha. A baixa alimenta automaticamente o Fluxo de Caixa.</p></div>' +
      '<div class="accounts-head-tools"><label>Empresa<select data-company-filter="' + type + '">' + companyOptions(companyFilters[type], true) + '</select></label><label class="accounts-upload">Importar planilha<input type="file" data-accounts-file="' + type + '" accept=".xlsx,.xls,.csv"></label></div></div>' +
      '<section class="accounts-card"><h3>Novo título</h3>' + accountForm(type) + '</section>' +
      '<section class="accounts-card"><h3>Títulos cadastrados</h3>' + recordTable(type) + '</section></div>';
    bindAccountContainer(container, type);
  }

  function bindAccountContainer(container, type) {
    var companyFilter = container.querySelector('[data-company-filter]');
    if (companyFilter) companyFilter.addEventListener('change', function () { companyFilters[type] = this.value; renderAccounts(type); });
    Array.from(container.querySelectorAll('[data-config-form]')).forEach(function (configForm) {
      configForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        try {
          await api({ action: 'upsert-financial-config', configType: configForm.dataset.configForm, name: configForm.elements.name.value });
        } catch (error) { alert(error.message); }
      });
    });
    Array.from(container.querySelectorAll('[data-financial-option-form]')).forEach(function (optionForm) {
      optionForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        try {
          await api({ action: 'upsert-financial-option', id: optionForm.elements.id ? optionForm.elements.id.value : '', classification: optionForm.elements.classification.value, category: optionForm.elements.category.value });
        } catch (error) { alert(error.message); }
      });
    });
    Array.from(container.querySelectorAll('[data-classification-form]')).forEach(function (classificationForm) {
      classificationForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        try {
          await api({ action: 'rename-financial-classification', previousName: classificationForm.elements.previousName.value, name: classificationForm.elements.name.value });
        } catch (error) { alert(error.message); }
      });
    });
    var form = container.querySelector('[data-account-form]');
    var classification = form.elements.classification;
    var category = form.elements.category;
    function updateCategories() {
      var values = options.filter(function (item) { return item.classification === classification.value; })
        .map(function (item) { return item.category; }).sort();
      category.innerHTML = optionHtml(values);
    }
    classification.addEventListener('change', updateCategories);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var payload = { action: 'upsert-account', type: type };
      Array.from(form.elements).forEach(function (input) {
        if (!input.name) return;
        payload[input.name] = input.name === 'amount' || input.name === 'installmentCount' ? number(input.value) : input.value;
      });
      if (type === 'payable' && form.elements.bankAccountId && form.elements.bankAccountId.value) {
        var selectedAccount = (state.bankAccounts || []).find(function (item) { return item.id === form.elements.bankAccountId.value; });
        payload.account = selectedAccount ? selectedAccount.name : '';
      }
      try { await api(payload); } catch (error) { alert(error.message); }
    });
    Array.from(container.querySelectorAll('[data-settle]')).forEach(function (button) {
      button.addEventListener('click', async function () {
        try {
          await api({ action: 'settle-account', type: type, id: button.dataset.settle, settledAt: new Date().toISOString().slice(0, 10) });
          var collection = type === 'payable' ? state.payables : state.receivables;
          var record = collection.find(function (item) { return item.id === button.dataset.settle; });
          var person = state.counterparties.find(function (item) { return item.id === record.counterpartyId; });
          var date = record.settledAt;
          if (window.financialClosing && window.financialClosing.addExternalRecord) {
            window.financialClosing.addExternalRecord({
              externalId: 'account-' + record.id, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)),
              date: date, dateLabel: date.split('-').reverse().join('/'), client: person ? person.name : '',
              history: record.description, category: record.category, classification: record.classification,
              companyId: record.companyId, company: ((state.companies || []).find(function (item) { return item.id === record.companyId; }) || {}).name || '',
              account: record.account, value: type === 'payable' ? -Math.abs(record.amount) : Math.abs(record.amount),
              type: type === 'payable' ? 'D' : 'C', line: 0
            });
          }
        } catch (error) { alert(error.message); }
      });
    });
    Array.from(container.querySelectorAll('[data-delete]')).forEach(function (button) {
      button.addEventListener('click', async function () {
        var collection = type === 'payable' ? state.payables : state.receivables;
        var record = collection.find(function (item) { return item.id === button.dataset.delete; });
        if (!record) return;
        var label = type === 'payable' ? 'conta a pagar' : 'conta a receber';
        if (!window.confirm('Excluir esta ' + label + ': "' + record.description + '"? Esta ação não poderá ser desfeita.')) return;
        try {
          var externalId = 'account-' + record.id;
          await api({ action: 'delete-account', type: type, id: record.id });
          if (window.financialClosing && window.financialClosing.removeExternalRecord) {
            window.financialClosing.removeExternalRecord(externalId);
          }
        } catch (error) { alert(error.message); }
      });
    });
    var input = container.querySelector('[data-accounts-file]');
    input.addEventListener('change', function () { importFile(input.files[0], type, companyFilters[type]); input.value = ''; });
  }

  async function importFile(file, type, companyId) {
    if (!file) return;
    if ((state.companies || []).length && !companyId) return alert('Selecione a empresa antes de importar a planilha.');
    try {
      var rows;
      if (/\.csv$/i.test(file.name)) {
        var text = await file.text();
        var delimiter = text.split(/\r?\n/, 1)[0].split(';').length > text.split(/\r?\n/, 1)[0].split(',').length ? ';' : ',';
        var lines = text.split(/\r?\n/).filter(Boolean).map(function (line) { return line.split(delimiter); });
        var headers = lines.shift().map(function (item) { return item.trim().toLowerCase(); });
        rows = lines.map(function (line) { var item = {}; headers.forEach(function (header, index) { item[header] = line[index]; }); return item; });
      } else {
        var workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      }
      var mapped = rows.map(function (row) {
        var get = function (names) { var key = Object.keys(row).find(function (item) { return names.indexOf(item.toLowerCase().trim()) >= 0; }); return key ? row[key] : ''; };
        var due = get(['vencimento', 'data vencimento', 'data']);
        if (due instanceof Date) due = due.toISOString().slice(0, 10);
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(due))) due = String(due).split('/').reverse().join('-');
        return {
          description: get(['descricao', 'descrição', 'historico', 'histórico']), dueDate: due,
          competenceDate: due, amount: number(get(['valor', 'valor total'])),
          classification: get(['classificacao', 'classificação']), category: get(['categoria']),
          account: get(['conta']), document: get(['documento', 'nf']), notes: get(['observacoes', 'observações'])
        };
      }).filter(function (row) { return row.description && row.dueDate && row.amount > 0; });
      await api({ action: 'import-accounts', type: type, companyId: companyId, rows: mapped });
    } catch (error) { alert(error.message); }
  }

  function renderCounterparties() {
    var container = document.getElementById('counterpartiesContainer');
    if (!container) return;
    container.innerHTML = '<div class="accounts-shell"><div class="accounts-head"><div><h2>Clientes e Fornecedores</h2><p>Cadastro único utilizado nas contas a pagar e a receber.</p></div></div>' +
      '<section class="accounts-card"><form class="accounts-form" id="counterpartyForm"><label>Nome<input name="name" required></label><label>Tipo<select name="kind"><option value="client">Cliente</option><option value="supplier">Fornecedor</option><option value="both">Cliente e fornecedor</option></select></label><label>CPF / CNPJ<input name="document"></label><label>E-mail<input name="email"></label><label>Telefone<input name="phone"></label><button class="accounts-primary" type="submit">Salvar cadastro</button></form></section>' +
      '<section class="accounts-card"><div class="counterparty-grid">' + (state.counterparties.length ? state.counterparties.map(function (item) {
        return '<article><strong>' + esc(item.name) + '</strong><span>' + esc(item.kind === 'client' ? 'Cliente' : item.kind === 'supplier' ? 'Fornecedor' : 'Cliente e fornecedor') + '</span><small>' + esc(item.document || item.email || 'Sem documento') + '</small></article>';
      }).join('') : '<div class="accounts-empty">Nenhum cliente ou fornecedor cadastrado.</div>') + '</div></section></div>';
    document.getElementById('counterpartyForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var payload = { action: 'upsert-counterparty' };
      Array.from(event.target.elements).forEach(function (input) { if (input.name) payload[input.name] = input.value; });
      try { await api(payload); } catch (error) { alert(error.message); }
    });
  }

  function renderFinancialConfig() {
    var container = document.getElementById('financialConfigContainer');
    if (!container) return;
    container.innerHTML = '<div class="accounts-shell"><div class="accounts-head"><div><h2>Configurações Financeiras</h2><p>Empresas, bancos e formas de pagamento usados em Contas a Pagar e a Receber.</p></div></div>' + configurationCard() + '</div>';
    Array.from(container.querySelectorAll('[data-config-form]')).forEach(function (form) { form.addEventListener('submit', async function (event) { event.preventDefault(); try { await api({ action: 'upsert-financial-config', configType: form.dataset.configForm, name: form.elements.name.value }); } catch (error) { alert(error.message); } }); });
  }

  function renderAll() { renderAccounts('payable'); renderAccounts('receivable'); renderCounterparties(); renderFinancialConfig(); }

  async function boot() {
    try {
      var loaded = await Promise.all([
        fetch('/api/accounts', { cache: 'no-store' }).then(function (response) { return response.json(); }),
        fetch('/api/financial-options', { cache: 'no-store' }).then(function (response) { return response.json(); })
      ]);
      state = loaded[0]; options = loaded[1].options || []; renderAll();
    } catch (error) { console.error('Falha ao carregar contas:', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
