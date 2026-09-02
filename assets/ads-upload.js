(function () {
  'use strict';

  var container = document.getElementById('adsUploadContainer');
  if (!container) return;

  container.innerHTML = '<div class="sales-upload-shell">' +
    '<section class="ads-treater-panel"><div class="ads-treater-head"><div><span class="sales-upload-eyebrow">CONSTRUÇÃO DA BASE · ADS</span><h2>Tratador de Arquivos de ADS</h2><p>O arquivo bruto fica salvo no disco persistente. Depois, o tratador converte os dados para as colunas oficiais e somente o resultado tratado pode alimentar a Base de Dados e os painéis.</p></div><span class="sales-upload-badge">/var/data</span></div>' +
    '<div class="ads-data-flow"><span class="active">1. Arquivo bruto</span><b>→</b><span>2. Tratamento</span><b>→</b><span>3. Base de Dados</span><b>→</b><span>4. Dashboard</span></div>' +
    '<div class="ads-treater-toolbar"><div><strong>Contas cadastradas no Tratador de Vendas</strong><span id="adsTreaterSummary">Carregando contas e histórico...</span></div><button id="adsReloadTreaters" type="button">↻ Recarregar tratadores</button></div>' +
    '<div id="adsTreaterHistory" class="ads-account-cards"></div></section>' +
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
  var historyBox = document.getElementById('adsTreaterHistory');
  var historySummary = document.getElementById('adsTreaterSummary');
  var preview = null;
  var uploadHistory = [];
  var excludedChannels = [];
  var registeredAccounts = [];
  var monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  monthSelect.innerHTML = monthNames.map(function (name, index) { return '<option value="' + (index + 1) + '">' + name + '</option>'; }).join('');
  monthSelect.value = String((typeof dashboardState !== 'undefined' && dashboardState.activeMonth) || new Date().getMonth() + 1);

  function refreshAccountOptions() {
    var platform = platformSelect.value;
    var excluded=new Set(excludedChannels.map(function(item){return clean(item.platform).toLowerCase()+'\u001f'+clean(item.account).toLowerCase();}));
    var accounts = registeredAccounts.filter(function (item) { return item.marketplace === platform&& !excluded.has(clean(item.marketplace).toLowerCase()+'\u001f'+clean(item.account).toLowerCase()); });
    accountSelect.innerHTML = '<option value="">Selecione a conta</option>' + accounts.map(function (item) {
      return '<option value="' + escapeHtml(item.account) + '">' + escapeHtml(item.account) + '</option>';
    }).join('');
    if (!accounts.length) accountSelect.innerHTML = '<option value="">Nenhuma conta cadastrada nesta plataforma</option>';
    accountSelect.disabled = !accounts.length;
    preview = null;
    publishButton.disabled = true;
    renderHistory();
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
    var named = text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/^(\d{1,2})[-\s](jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-\s](\d{4})$/);
    if(named){var namedMonths={jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};return named[3]+'-'+String(namedMonths[named[2]]).padStart(2,'0')+'-'+named[1].padStart(2,'0');}
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
  function readRawWorkbook(file) {
    return file.arrayBuffer().then(function(buffer){
      var workbook=XLSX.read(buffer,{type:'array',cellDates:true});
      var expected='relatorio anuncios patrocinados';
      var sheetName=workbook.SheetNames.find(function(name){return clean(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===expected;});
      if(!sheetName)throw new Error('A aba "Relatório Anúncios patrocinados" não foi encontrada.');
      return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true});
    });
  }
  function parseMercadoLivreRaw(matrix,account){
    if(!matrix||matrix.length<3)throw new Error('O relatório de ADS está vazio.');
    var headers=(matrix[1]||[]).map(function(value){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');});
    function column(needle){return headers.findIndex(function(header){return header.indexOf(needle)>=0;});}
    var idx={from:column('desde'),to:column('ate'),ad:column('codigo do anuncio'),clicks:column('cliques'),revenue:column('receita'),investment:column('investimento')};
    var missing=Object.keys(idx).filter(function(key){return idx[key]<0;});
    if(missing.length)throw new Error('Colunas obrigatórias não encontradas no relatório: '+missing.join(', ')+'.');
    var aggregate=new Map(),sourceRows=0;
    matrix.slice(2).forEach(function(row){
      var ad=clean(row[idx.ad]),date=excelDate(row[idx.from]||row[idx.to]);
      if(!ad||!date)return;
      sourceRows+=1;
      var key=[account,date,ad].join('\u001f'),current=aggregate.get(key)||{date:date,ad:ad,revenue:0,investment:0,clicks:0,sourceRows:0};
      current.revenue+=numberValue(row[idx.revenue]);current.investment+=numberValue(row[idx.investment]);current.clicks+=numberValue(row[idx.clicks]);current.sourceRows+=1;aggregate.set(key,current);
    });
    if(!aggregate.size)throw new Error('Nenhum anúncio válido foi encontrado no relatório.');
    var rows=[];aggregate.forEach(function(item){
      rows.push({marketplace:'Mercado Livre',marketplaceSale:account,sku:'',ad:item.ad,date:item.date,category:'ADS F',subcategory:'ADS F',value:item.revenue});
      rows.push({marketplace:'Mercado Livre',marketplaceSale:account,sku:'',ad:item.ad,date:item.date,category:'03.Despesas Marketplace',subcategory:'Publicidade',value:-Math.abs(item.investment)});
      rows.push({marketplace:'Mercado Livre',marketplaceSale:account,sku:'',ad:item.ad,date:item.date,category:'Cliques',subcategory:'Cliques',value:item.clicks});
    });
    var dates=Array.from(aggregate.values()).map(function(item){return item.date;}).sort();
    return{rows:rows,sourceRows:sourceRows,ads:aggregate.size,duplicatesConsolidated:sourceRows-aggregate.size,minDate:dates[0],maxDate:dates[dates.length-1]};
  }
  function parseShopeeRaw(matrix,account){
    if(!matrix||!matrix.length)throw new Error('O relatório de ADS da Shopee está vazio.');
    var normalized=matrix.map(function(row){return (row||[]).map(function(value){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');});});
    var headerIndex=normalized.findIndex(function(row){return row.indexOf('nome do anuncio')>=0&&row.indexOf('cliques')>=0&&row.indexOf('gmv')>=0&&row.indexOf('despesas')>=0;});
    if(headerIndex<0)throw new Error('As colunas Nome do Anúncio, Cliques, GMV e Despesas não foram encontradas no relatório da Shopee.');
    var headers=normalized[headerIndex];
    function column(name){return headers.indexOf(name);}
    var idx={name:column('nome do anuncio'),ad:column('id do produto'),clicks:column('cliques'),revenue:column('gmv'),investment:column('despesas')};
    var aggregate=new Map(),sourceRows=0;
    matrix.slice(headerIndex+1).forEach(function(row){
      var productId=clean(row[idx.ad]),name=clean(row[idx.name]),ad=productId&&productId!=='-'?productId:name;
      if(!ad)return;
      sourceRows+=1;
      var key=[account,ad].join('\u001f'),current=aggregate.get(key)||{ad:ad,revenue:0,investment:0,clicks:0,sourceRows:0};
      current.revenue+=numberValue(row[idx.revenue]);current.investment+=numberValue(row[idx.investment]);current.clicks+=numberValue(row[idx.clicks]);current.sourceRows+=1;aggregate.set(key,current);
    });
    if(!aggregate.size)throw new Error('Nenhum anúncio válido foi encontrado no relatório da Shopee.');
    var rows=[];aggregate.forEach(function(item){
      rows.push({marketplace:'Shopee',marketplaceSale:account,sku:'',ad:item.ad,date:'',category:'ADS F',subcategory:'ADS F',value:item.revenue});
      rows.push({marketplace:'Shopee',marketplaceSale:account,sku:'',ad:item.ad,date:'',category:'03.Despesas Marketplace',subcategory:'Publicidade',value:-Math.abs(item.investment)});
      rows.push({marketplace:'Shopee',marketplaceSale:account,sku:'',ad:item.ad,date:'',category:'Cliques',subcategory:'Cliques',value:item.clicks});
    });
    return{rows:rows,sourceRows:sourceRows,ads:aggregate.size,duplicatesConsolidated:sourceRows-aggregate.size,minDate:'',maxDate:''};
  }
  function fileBase64(file) { return file.arrayBuffer().then(function(buffer){var bytes=new Uint8Array(buffer),chunk=0x8000,binary='';for(var i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));return btoa(binary);}); }
  function formatBytes(value){var n=Number(value)||0;return n<1024?n+' B':n<1048576?(n/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})+' KB':(n/1048576).toLocaleString('pt-BR',{maximumFractionDigits:1})+' MB';}
  function dateTime(value){if(!value)return '—';return new Date(value).toLocaleString('pt-BR');}
  function uploadMarkup(item){
    var status=item.status==='published'?'<em>Publicado em '+dateTime(item.addedToBaseAt)+'</em>':item.status==='treated'?'<em>Tratado · '+Number(item.treatedRows).toLocaleString('pt-BR')+' linhas</em>':'<em class="pending">Aguardando tratamento</em>';
    var action=item.status==='raw'?'<button type="button" disabled>Aguardando tratador</button>':'<button type="button" data-add-upload>'+(item.status==='published'?'Republicar':'Enviar para a base')+'</button>';
    return '<article class="ads-account-upload" data-upload-id="'+item.id+'"><div class="ads-upload-number">Dia '+item.day+' · Subida '+item.sequence+'</div><small>'+escapeHtml(item.fileName)+' · '+formatBytes(item.size)+'</small>'+status+'<div><a href="/api/ads-treater/file?id='+encodeURIComponent(item.id)+'">Baixar</a>'+action+'<button type="button" class="danger" data-delete-upload>Excluir</button></div></article>';
  }
  function treatedMonthInfo(rows,year,month){
    var monthRows=rows.filter(function(item){return (item.status==='treated'||item.status==='published')&&Number(item.year)===Number(year)&&Number(item.month)===Number(month);}).sort(function(a,b){return Number(a.day)-Number(b.day)||Number(a.sequence)-Number(b.sequence);});
    if(!monthRows.length)return null;
    var days=Array.from(new Set(monthRows.map(function(item){return Number(item.day);}))).sort(function(a,b){return a-b;});
    return{year:Number(year),month:Number(month),rows:monthRows,days:days};
  }
  function updateSelectedMonth(card){
    var account=card.getAttribute('data-ads-account'),platform=card.getAttribute('data-ads-platform'),year=Number(card.getAttribute('data-card-year'))||new Date().getFullYear(),month=Number(card.querySelector('[data-card-month]').value),info=treatedMonthInfo(uploadHistory.filter(function(item){return item.account===account&&item.platform===platform;}),year,month),label=monthNames[month-1]+'/'+year,button=card.querySelector('[data-republish-selected]'),summary=card.querySelector('[data-selected-month-info]');
    button.disabled=!info;
    button.textContent='Republicar mês selecionado ('+label+')';
    summary.textContent=info?'Dias disponíveis em '+label+': '+info.days.join(', '):'Nenhum dia tratado em '+label+'.';
  }
  function renderHistory(){
    var excluded=new Set(excludedChannels.map(function(item){return clean(item.platform).toLowerCase()+'\u001f'+clean(item.account).toLowerCase();}));
    var accounts=[],seen=new Set();registeredAccounts.forEach(function(item){var key=item.marketplace+'\u001f'+item.account,normalizedKey=clean(item.marketplace).toLowerCase()+'\u001f'+clean(item.account).toLowerCase();if(!item.account||seen.has(key)||excluded.has(normalizedKey))return;seen.add(key);accounts.push(item);});
    historySummary.textContent=accounts.length.toLocaleString('pt-BR')+' conta(s) · '+uploadHistory.length.toLocaleString('pt-BR')+' subida(s)';
    if(!accounts.length){historyBox.innerHTML='<div class="ads-treater-empty">Nenhuma conta cadastrada. Cadastre primeiro no Tratador de Vendas.</div>';return;}
    var now=new Date(),defaultYear=now.getFullYear(),monthOptions=monthNames.map(function(name,index){return '<option value="'+(index+1)+'"'+(index===now.getMonth()?' selected':'')+'>'+name+'</option>';}).join('');
    historyBox.innerHTML=accounts.map(function(account){
      var accountRows=uploadHistory.filter(function(item){return item.account===account.account&&item.platform===account.marketplace;});
      var years=accountRows.map(function(item){return Number(item.year);}).filter(Boolean);var year=years.length?Math.max.apply(null,years):defaultYear;
      var months=monthNames.map(function(name,index){
        var rows=accountRows.filter(function(item){return Number(item.year)===year&&Number(item.month)===index+1;}).sort(function(a,b){return Number(a.day)-Number(b.day)||Number(a.sequence)-Number(b.sequence);});
        return '<details class="ads-account-month'+(rows.length?' is-filled':'')+'"><summary><span><strong>'+name+' / '+year+'</strong><small>'+(rows.length?rows.length+' subida(s)':'Ainda não alimentado')+'</small></span><i aria-hidden="true">⌄</i></summary><div class="ads-account-month-content">'+(rows.length?rows.map(uploadMarkup).join(''):'<p>Nenhum arquivo cadastrado neste mês.</p>')+'</div></details>';
      }).join('');
      var treatedCount=accountRows.filter(function(item){return item.status==='treated'||item.status==='published';}).length,currentInfo=treatedMonthInfo(accountRows,defaultYear,now.getMonth()+1),currentLabel=monthNames[now.getMonth()]+'/'+defaultYear;
      return '<article class="ads-account-card" data-ads-account="'+escapeHtml(account.account)+'" data-ads-platform="'+escapeHtml(account.marketplace)+'" data-sales-channel-id="'+escapeHtml(account.channelId||'')+'" data-card-year="'+defaultYear+'"><header><div><span>'+escapeHtml(account.marketplace)+'</span><h3>'+escapeHtml(account.account)+'</h3></div><div class="ads-account-controls"><label>Mês<select data-card-month>'+monthOptions+'</select></label><label class="ads-card-file">Selecionar relatórios brutos<input data-card-file type="file" multiple accept=".xlsx,.xlsm,.xls,.csv,.zip,.txt"></label><button type="button" data-card-save>Tratar e salvar arquivos</button><button type="button" data-republish-selected'+(currentInfo?'':' disabled')+'>Republicar mês selecionado ('+currentLabel+')</button><button type="button" class="ads-delete-channel" data-delete-channel>Excluir canal</button></div></header><div class="ads-account-meta">Vinculado ao Tratador de Vendas · O dia é identificado automaticamente pelo nome de cada arquivo (ex.: 1.xlsx = dia 1). · '+accountRows.length+' subida(s) no disco · '+treatedCount+' tratada(s) · <span data-selected-month-info>'+(currentInfo?'Dias disponíveis em '+currentLabel+': '+currentInfo.days.join(', '):'Nenhum dia tratado em '+currentLabel+'.')+'</span></div><div class="ads-account-operation" data-account-status></div><h4 class="ads-monthly-title">Controle mensal de arquivos</h4><div class="ads-account-month-grid">'+months+'</div></article>';
    }).join('');
  }
  async function loadHistory(){try{var response=await fetch('/api/ads-treater/uploads',{cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível carregar o histórico.');uploadHistory=result.uploads||[];excludedChannels=result.excludedChannels||[];refreshAccountOptions();renderHistory();}catch(error){historyBox.innerHTML='<div class="ads-treater-empty">'+escapeHtml(error.message)+'</div>';historySummary.textContent='Falha ao carregar';}}
  async function publishTreatedUpload(item,password){
    var treatedResponse=await fetch('/api/ads-treater/treated?id='+encodeURIComponent(item.id),{cache:'no-store'}),treated=await treatedResponse.json();
    if(!treatedResponse.ok)throw new Error(treated.error||'O resultado tratado da subida '+item.sequence+' não está disponível.');
    if(!treated.rows||!treated.rows.length)throw new Error('A subida '+item.sequence+' não gerou linhas para a Base de Dados.');
    var response=await fetch('/api/ads-base',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({month:item.month,platform:item.platform,account:item.account,rows:treated.rows,append:true,uploadId:item.id})});
    var result=await response.json();
    if(!response.ok)throw new Error(result.error||'Não foi possível publicar a subida '+item.sequence+'.');
    return result;
  }
  function dayFromFileName(fileName,year,month){
    var base=String(fileName||'').replace(/\.[^.]+$/,'').trim();
    var match=base.match(/^(\d{1,2})(?:\D|$)/);
    var day=match?Number(match[1]):0;
    if(!day){
      var dates=Array.from(base.matchAll(/(?:^|\D)(\d{1,2})[_-](\d{1,2})[_-](\d{4})(?=\D|$)/g));
      if(dates.length){
        var reportDate=dates[dates.length-1];
        if(Number(reportDate[2])!==Number(month)||Number(reportDate[3])!==Number(year))throw new Error('A data no nome do arquivo "'+fileName+'" não pertence ao mês selecionado.');
        day=Number(reportDate[1]);
      }
    }
    if(!day)throw new Error('Não foi possível identificar o dia em "'+fileName+'". Use 1.xlsx ou mantenha a data DD_MM_AAAA no nome exportado.');
    var lastDay=new Date(Number(year),Number(month),0).getDate();
    if(day<1||day>lastDay)throw new Error('O dia '+day+' do arquivo "'+fileName+'" não é válido para o mês selecionado.');
    return day;
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
  historyBox.addEventListener('click',async function(event){
    var deleteChannelButton=event.target.closest('[data-delete-channel]');
    if(deleteChannelButton){
      var deleteCard=deleteChannelButton.closest('.ads-account-card'),deleteAccount=deleteCard.getAttribute('data-ads-account'),deletePlatform=deleteCard.getAttribute('data-ads-platform'),deleteStatus=deleteCard.querySelector('[data-account-status]');
      if(!confirm('Excluir o canal de ADS "'+deletePlatform+' - '+deleteAccount+'"?\n\nSerão removidos os arquivos brutos, os tratados e todas as linhas de ADS/Publicidade/Cliques desse canal em todos os meses. As vendas não serão alteradas.'))return;
      var deletePassword=document.getElementById('adsUploadPassword').value||prompt('Informe a senha administrativa para confirmar a exclusão do canal de ADS:');
      if(!deletePassword)return;
      try{
        deleteChannelButton.disabled=true;deleteStatus.textContent='Criando backup e excluindo o canal de ADS...';
        var deleteResponse=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':deletePassword},body:JSON.stringify({action:'delete-channel',platform:deletePlatform,account:deleteAccount})}),deleteResult=await deleteResponse.json();
        if(!deleteResponse.ok)throw new Error(deleteResult.error||'Não foi possível excluir o canal de ADS.');
        uploadHistory=deleteResult.uploads||[];excludedChannels=deleteResult.excludedChannels||[];
        refreshAccountOptions();renderHistory();
        alert('Canal de ADS excluído. '+Number(deleteResult.deleted.removedUploads||0)+' arquivo(s) e '+Number(deleteResult.deleted.removedRows||0)+' linha(s) de ADS removidos. As vendas foram preservadas.');
      }catch(error){deleteChannelButton.disabled=false;deleteStatus.textContent=error.message;alert(error.message);}
      return;
    }
    var bulkButton=event.target.closest('[data-republish-selected]');
    if(bulkButton){
      var bulkCard=bulkButton.closest('.ads-account-card'),bulkAccount=bulkCard.getAttribute('data-ads-account'),bulkPlatform=bulkCard.getAttribute('data-ads-platform'),bulkStatus=bulkCard.querySelector('[data-account-status]');
      var selectedYear=Number(bulkCard.getAttribute('data-card-year'))||new Date().getFullYear(),selectedMonth=Number(bulkCard.querySelector('[data-card-month]').value),selected=treatedMonthInfo(uploadHistory.filter(function(item){return item.account===bulkAccount&&item.platform===bulkPlatform;}),selectedYear,selectedMonth),bulkRows=selected?selected.rows:[];
      if(!selected||!bulkRows.length){alert('Nenhuma base tratada foi encontrada no mês selecionado.');return;}
      var bulkLabel=monthNames[selected.month-1]+'/'+selected.year,bulkPassword=document.getElementById('adsUploadPassword').value||prompt('Informe a senha administrativa para republicar '+bulkLabel+':');
      if(!bulkPassword)return;
      try{
        bulkButton.disabled=true;var total=0;
        for(var bulkIndex=0;bulkIndex<bulkRows.length;bulkIndex+=1){bulkButton.textContent='Republicando '+(bulkIndex+1)+' de '+bulkRows.length+'...';bulkStatus.textContent='Publicando '+monthNames[Number(bulkRows[bulkIndex].month)-1]+' · dia '+bulkRows[bulkIndex].day+' · subida '+bulkRows[bulkIndex].sequence;var bulkResult=await publishTreatedUpload(bulkRows[bulkIndex],bulkPassword);total+=Number(bulkResult.added)||0;}
        bulkStatus.innerHTML='<strong>'+bulkLabel+' republicado.</strong> Dias '+selected.days.join(', ')+' · '+bulkRows.length+' base(s) e '+total.toLocaleString('pt-BR')+' linha(s) de ADS consolidadas com as vendas.';
        await loadHistory();
      }catch(error){bulkStatus.textContent=error.message;alert(error.message);}finally{bulkButton.disabled=false;bulkButton.textContent='Republicar mês selecionado ('+bulkLabel+')';}
      return;
    }
    if(event.target.matches('[data-card-save]')){
      var accountCard=event.target.closest('.ads-account-card'),button=event.target,account=accountCard.getAttribute('data-ads-account'),platform=accountCard.getAttribute('data-ads-platform'),salesChannelId=accountCard.getAttribute('data-sales-channel-id')||'',year=Number(accountCard.getAttribute('data-card-year'))||new Date().getFullYear(),month=Number(accountCard.querySelector('[data-card-month]').value),files=Array.from(accountCard.querySelector('[data-card-file]').files||[]),password=document.getElementById('adsUploadPassword').value,accountStatus=accountCard.querySelector('[data-account-status]');
      try{
        if(!files.length)throw new Error('Selecione um ou mais arquivos diários de ADS desta conta.');
        if(!password)throw new Error('Informe a senha administrativa no painel abaixo.');
        var prepared=files.map(function(file){return{file:file,day:dayFromFileName(file.name,year,month)};}).sort(function(a,b){return a.day-b.day||a.file.name.localeCompare(b.file.name);});
        button.disabled=true;
        var completed=0,totalRows=0,totalAds=0;
        for(var fileIndex=0;fileIndex<prepared.length;fileIndex+=1){
          var current=prepared[fileIndex],file=current.file,day=current.day,transformed=null;
          button.textContent='Tratando '+(fileIndex+1)+' de '+prepared.length+'...';
          accountStatus.textContent='Dia '+day+' · '+file.name;
          if(platform==='Mercado Livre'||platform==='Shopee'){
            transformed=platform==='Mercado Livre'?parseMercadoLivreRaw(await readRawWorkbook(file),account):parseShopeeRaw(await readWorkbook(file),account);
            var selectedDate=[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
            transformed.rows.forEach(function(row){row.date=selectedDate;});
            transformed.minDate=selectedDate;transformed.maxDate=selectedDate;
          }
          var response=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({action:'add',platform:platform,account:account,salesChannelId:salesChannelId,year:year,month:month,day:day,fileName:file.name,dataBase64:await fileBase64(file)})}),result=await response.json();
          if(!response.ok)throw new Error(result.error||'Não foi possível salvar "'+file.name+'".');
          if(transformed){
            var treatedResponse=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({action:'save-treated',id:result.upload.id,rows:transformed.rows})}),treatedResult=await treatedResponse.json();
            if(!treatedResponse.ok)throw new Error(treatedResult.error||'O arquivo "'+file.name+'" foi salvo, mas o tratamento falhou.');
            uploadHistory=treatedResult.uploads||[];totalRows+=transformed.rows.length;totalAds+=transformed.ads;
          }else uploadHistory=result.uploads||[];
          completed+=1;
        }
        var successMessage=completed+' arquivo(s) salvo(s) com sucesso. '+totalAds.toLocaleString('pt-BR')+' anúncios e '+totalRows.toLocaleString('pt-BR')+' linhas tratadas. Dias identificados pelo nome dos arquivos.';
        accountStatus.innerHTML='<strong>'+successMessage+'</strong>';
        accountCard.querySelector('[data-card-file]').value='';
        renderHistory();
        alert(successMessage);
      }catch(error){accountStatus.textContent=error.message;alert(error.message);}
      finally{button.disabled=false;button.textContent='Tratar e salvar arquivos';}
      return;
    }
    var card=event.target.closest('[data-upload-id]');if(!card)return;var id=card.getAttribute('data-upload-id'),item=uploadHistory.find(function(entry){return entry.id===id;});if(!item)return;
    if(event.target.matches('[data-delete-upload]')){if(!confirm('Excluir a subida '+item.sequence+' do dia '+item.day+'? O arquivo será removido do disco.'))return;var password=prompt('Informe a senha administrativa para excluir:');if(!password)return;try{var response=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({action:'delete',id:id})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível excluir.');uploadHistory=result.uploads||[];renderHistory();}catch(error){alert(error.message);}return;}
    if(event.target.closest('[data-add-upload]')){try{var password=document.getElementById('adsUploadPassword').value||prompt('Informe a senha administrativa para republicar esta base de ADS:');if(!password)return;statusBox.textContent='Carregando o resultado tratado da subida '+item.sequence+'...';var result=await publishTreatedUpload(item,password);statusBox.innerHTML='<strong>Arquivo tratado publicado</strong><br>'+result.added.toLocaleString('pt-BR')+' linhas adicionadas à Base de Dados e disponibilizadas aos painéis.';await loadHistory();}catch(error){statusBox.textContent=error.message;alert(error.message);}return;}
  });
  historyBox.addEventListener('change',function(event){if(event.target.matches('[data-card-month]'))updateSelectedMonth(event.target.closest('.ads-account-card'));});
  document.getElementById('adsReloadTreaters').onclick=async function(){
    var button=this,password=document.getElementById('adsUploadPassword').value||prompt('Informe a senha administrativa para sincronizar os canais de ADS:');
    if(!password)return;
    try{
      button.disabled=true;button.textContent='↻ Sincronizando...';historySummary.textContent='Recarregando canais e vínculos...';
      var response=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({action:'sync-channels'})}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'Não foi possível sincronizar os tratadores.');
      registeredAccounts=Array.isArray(result.accounts)?result.accounts:[];uploadHistory=result.uploads||[];excludedChannels=result.excludedChannels||[];
      refreshAccountOptions();renderHistory();
      alert('Tratadores recarregados. '+Number(result.synchronized.accounts||0)+' conta(s) vinculada(s) pelo mesmo nome e plataforma. '+Number(result.synchronized.restoredChannels||0)+' canal(is) reativado(s) no ADS.');
    }catch(error){historySummary.textContent=error.message;alert(error.message);}finally{button.disabled=false;button.textContent='↻ Recarregar tratadores';}
  };
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
        body: JSON.stringify({ month: monthSelect.value, platform: platformSelect.value, account: accountSelect.value, rows: preview.rows, append: true }) });
      var result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível publicar a base de ADS.');
      statusBox.innerHTML = '<strong>ADS incorporado à Base de Vendas</strong><br>' + result.added.toLocaleString('pt-BR') + ' linhas de Publicidade, Cliques e ADS F adicionadas · ' + result.replaced.toLocaleString('pt-BR') + ' métricas do mesmo anúncio e dia atualizadas. As vendas foram preservadas.';
      document.getElementById('adsUploadPassword').value = '';
      setTimeout(function () { window.location.reload(); }, 900);
    } catch (error) { statusBox.textContent = error.message; publishButton.disabled = false; publishButton.textContent = 'Adicionar à Base de Dados'; }
  };
  window.adsBaseIntegration={
    republishAll:async function(password,onProgress){
      await loadHistory();
      var rows=uploadHistory.filter(function(item){return item.status==='treated'||item.status==='published';})
        .sort(function(a,b){return Number(a.year)-Number(b.year)||Number(a.month)-Number(b.month)||Number(a.day)-Number(b.day)||Number(a.sequence)-Number(b.sequence);});
      var total=0,retreated=0;
      for(var index=0;index<rows.length;index+=1){
        var item=rows[index];
        if(typeof onProgress==='function')onProgress('Retratando ADS · '+item.platform+' - '+item.account+' · '+monthNames[Number(item.month)-1]+'/'+item.year+' · dia '+item.day+' ('+(index+1)+' de '+rows.length+')...');
        if(item.platform==='Mercado Livre'||item.platform==='Shopee'){
          var rawResponse=await fetch('/api/ads-treater/file?id='+encodeURIComponent(item.id),{cache:'no-store'});
          if(!rawResponse.ok)throw new Error('O arquivo bruto da subida '+item.sequence+' do dia '+item.day+' não está disponível para retratamento.');
          var rawFile=new File([await rawResponse.blob()],item.fileName||('ads-'+item.day+'.xlsx'));
          var transformed=item.platform==='Mercado Livre'?parseMercadoLivreRaw(await readRawWorkbook(rawFile),item.account):parseShopeeRaw(await readWorkbook(rawFile),item.account);
          var selectedDate=[item.year,String(item.month).padStart(2,'0'),String(item.day).padStart(2,'0')].join('-');
          transformed.rows.forEach(function(row){row.date=selectedDate;});
          var saveResponse=await fetch('/api/ads-treater/uploads',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({action:'save-treated',id:item.id,rows:transformed.rows})}),saveResult=await saveResponse.json();
          if(!saveResponse.ok)throw new Error(saveResult.error||'Não foi possível salvar o novo tratamento de ADS.');
          retreated+=1;
        }
        if(typeof onProgress==='function')onProgress('Republicando ADS · '+item.platform+' - '+item.account+' · dia '+item.day+' ('+(index+1)+' de '+rows.length+')...');
        var result=await publishTreatedUpload(item,password);total+=Number(result.added)||0;
      }
      await loadHistory();
      return {uploads:rows.length,rows:total,retreated:retreated};
    }
  };
  loadHistory();
})();
