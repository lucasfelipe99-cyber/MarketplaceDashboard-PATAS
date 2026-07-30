(function () {
  'use strict';
  var container = document.getElementById('salesTreatersContainer');
  if (!container) return;
  var state = { channels: [] };
  var preparedRows = {};
  var months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var publishHeaders = ['Marketplace','Marketplace venda','N.º de venda','Data da venda','Data','Estado','Type.1','Forma de entrega','# de anúncio','Título do anúncio','SKU','Preço unitário de venda do anúncio (BRL)','Unidades','Faturamento','Desconto','rebate','Comissão','Frete','Cancelamento','Liquido','Antecipa','Imposto','Custo do produto','Gross margen','Gross margen %','Id mercado Pago'];

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function norm(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
  function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var text = String(value == null ? '' : value).replace(/R\$/gi, '').replace(/\s/g, '');
    if (text.indexOf(',') >= 0) text = text.replace(/\./g, '').replace(',', '.');
    var result = Number(text); return Number.isFinite(result) ? result : 0;
  }
  function find(headers, aliases) { return headers.findIndex(function (h) { return aliases.map(norm).indexOf(norm(h)) >= 0; }); }
  function dateValue(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
    var text = String(value || '').trim();
    var br = text.match(/^(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
    var names = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    if (br) { var month = names.indexOf(norm(br[2])); if (month >= 0) return br[3] + '-' + String(month + 1).padStart(2, '0') + '-' + String(br[1]).padStart(2, '0'); }
    var parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
  async function costs() {
    var response = await fetch('/api/pricing-database', { cache: 'no-store' });
    var data = response.ok ? await response.json() : {};
    var result = {}; Object.keys(data.costs || {}).forEach(function (sku) { result[sku] = num(data.costs[sku].productCost); }); return result;
  }
  function statusType(value) { var key = norm(value); if (/devolu|devolv|reembolso|retorn/.test(key) && !/mediacao com devolucao habilitada/.test(key)) return 'Devolução'; return /cancel|recusada/.test(key) ? 'Cancelada' : 'Venda'; }

  function selectedDate(value, selectedMonth) {
    var original = dateValue(value);
    if (!original) return '';
    var parts = original.split('-'), year = new Date().getFullYear(), month = Number(selectedMonth);
    var day = Math.min(Number(parts[2]) || 1, new Date(Date.UTC(year, month, 0)).getUTCDate());
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  async function transform(file, channel, selectedMonth) {
    var workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, cellStyles: true });
    var sheet = workbook.Sheets['Vendas BR'];
    if (!sheet) throw new Error('O arquivo precisa conter a aba Vendas BR.');
    var matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    // Regra idêntica ao projeto-base: linhas 1 a 5 são informativas e a linha 6 é o cabeçalho.
    var headerRow = 5;
    if (!matrix[headerRow] || find(matrix[headerRow], ['N.º de venda', 'Nº de venda']) < 0 || find(matrix[headerRow], ['Estado']) < 0) {
      throw new Error('Cabeçalho esperado na linha 6 da aba Vendas BR não encontrado.');
    }
    var h = matrix[headerRow].map(String), saleHeaderIndex = find(matrix[headerRow], ['N.º de venda','Nº de venda']), stateHeaderIndex = find(matrix[headerRow], ['Estado']);
    var rows = matrix.slice(headerRow + 1).filter(function (row) {
      if (!row.some(function (v) { return String(v || '').trim(); })) return false;
      return norm(row[saleHeaderIndex]) !== norm('N.º de venda') && norm(row[stateHeaderIndex]) !== norm('Estado');
    });
    var redStart = find(h, ['Pertence a um kit']), redEnd = find(h, ['Cancelamentos e reembolsos (BRL)']), redLines = [];
    if (redStart >= 0 && redEnd >= redStart) {
      for (var rr = headerRow + 1; rr < matrix.length; rr += 1) {
        for (var cc = redStart; cc <= redEnd; cc += 1) {
          var cell = sheet[XLSX.utils.encode_cell({ r: rr, c: cc })], rgb = cell && cell.s && cell.s.fill && cell.s.fill.fgColor && String(cell.s.fill.fgColor.rgb || '').replace(/^FF/, '');
          if (rgb && rgb.length === 6) { var red=parseInt(rgb.slice(0,2),16),green=parseInt(rgb.slice(2,4),16),blue=parseInt(rgb.slice(4,6),16); if(red>=220&&red-green>=20&&red-blue>=20){redLines.push(rr+1);break;} }
        }
      }
    }
    if (redLines.length) throw new Error('Arquivo não aceito: ' + redLines.length + ' linha(s) financeira(s) em vermelho. Baixe um novo relatório do Mercado Livre.');
    var ix = {
      sale:find(h,['N.º de venda','Nº de venda']), date:find(h,['Data da venda']), state:find(h,['Estado']), units:find(h,['Unidades']), revenue:find(h,['Receita por produtos (BRL)']),
      fee:find(h,['Tarifa de venda e impostos (BRL)']), shipRevenue:find(h,['Receita por envio (BRL)']), shipFee:find(h,['Tarifas de envio (BRL)']), cancel:find(h,['Cancelamentos e reembolsos (BRL)']), total:find(h,['Total (BRL)']),
      sku:find(h,['SKU']), ad:find(h,['# de anúncio']), title:find(h,['Título do anúncio']), price:find(h,['Preço unitário de venda do anúncio (BRL)']), carrier:find(h,['Transportador']), tracking:find(h,['Número de rastreamento']), delivery:find(h,['Forma de entrega'])
    };
    var missing = Object.keys(ix).filter(function (key) { return ix[key] < 0; });
    if (missing.length) throw new Error('Colunas obrigatórias ausentes: ' + missing.join(', ') + '.');
    function blank(value) { return value == null || String(value).trim() === ''; }
    // Replica o Power Query/projeto-base: o Mercado Livre deixa estes dados na
    // linha seguinte em vendas agrupadas. Preenchemos para cima antes do rateio.
    [ix.price, ix.units, ix.title, ix.ad, ix.sku].forEach(function (columnIndex) {
      var nextValue = '';
      for (var fillRow = rows.length - 1; fillRow >= 0; fillRow -= 1) {
        if (!blank(rows[fillRow][columnIndex])) nextValue = rows[fillRow][columnIndex];
        else if (!blank(nextValue)) rows[fillRow][columnIndex] = nextValue;
      }
    });
    // Forma de entrega segue o preenchimento para baixo do projeto-base.
    var previousDelivery = '';
    rows.forEach(function (row) {
      if (!blank(row[ix.delivery])) previousDelivery = row[ix.delivery];
      else if (!blank(previousDelivery)) row[ix.delivery] = previousDelivery;
    });
    var lastId = '', groups = {}, items = [];
    rows.forEach(function (row, line) {
      var stateText = String(row[ix.state] || '').trim(); if (!stateText) return;
      var parent = /^pacote de/i.test(stateText), tracking = String(row[ix.tracking] || '').trim(), sale = String(row[ix.sale] || '').replace(/\.0$/, '').trim();
      var id = tracking || (parent || String(row[ix.carrier] || '').trim() ? sale : '') || lastId || sale; lastId = id;
      var item = { row:row, line:headerRow + line + 2, id:id, parent:parent };
      (groups[id] || (groups[id] = [])).push(item); items.push(item);
    });
    var costMap = await costs(), headers = ['Marketplace','Marketplace venda','N.º de venda','Data da venda','Data','Estado','Type.1','Forma de entrega','# de anúncio','Título do anúncio','SKU','Preço unitário de venda do anúncio (BRL)','Unidades','Faturamento','Desconto','rebate','Comissão','Frete','Cancelamento','Liquido','Antecipa','Imposto','Custo do produto','Gross margen','Gross margen %','Id mercado Pago'];
    var output = [headers];
    Object.keys(groups).forEach(function (id) {
      var group = groups[id], parent = group.find(function (x) { return x.parent; }), children = group.filter(function (x) { return !x.parent; });
      children.forEach(function (item) {
        var r = item.row, units = num(r[ix.units]), directRevenue = num(r[ix.revenue]), price = num(r[ix.price]);
        var title = String(r[ix.title] || '').trim();
        var faturamento = parent ? price * units : directRevenue; if (!faturamento) return;
        var parentRevenue = parent ? num(parent.row[ix.revenue]) : 0, ratio = parentRevenue ? faturamento / parentRevenue : 0;
        var fee = parent ? ratio * num(parent.row[ix.fee]) : num(r[ix.fee]);
        var freight = parent ? ratio * (num(parent.row[ix.shipRevenue]) + num(parent.row[ix.shipFee])) : num(r[ix.shipRevenue]) + num(r[ix.shipFee]);
        var sourceTotal = parent ? num(parent.row[ix.total]) : num(r[ix.total]);
        var sourceRevenue = parent ? num(parent.row[ix.revenue]) : directRevenue;
        var sourceFee = parent ? num(parent.row[ix.fee]) : num(r[ix.fee]);
        var sourceFreight = parent ? num(parent.row[ix.shipRevenue]) + num(parent.row[ix.shipFee]) : freight;
        var sourceCancel = parent ? num(parent.row[ix.cancel]) : num(r[ix.cancel]);
        var adjustment = sourceTotal - sourceRevenue - sourceFee - sourceFreight - sourceCancel;
        adjustment = parent ? adjustment / Math.max(1, children.length) : adjustment;
        var rebate = adjustment > 0 ? adjustment : 0, discount = adjustment < 0 ? adjustment : 0;
        var saleStatus=statusType(r[ix.state]),cancelled=saleStatus==='Cancelada',returned=saleStatus==='Devolução',inactive=cancelled||returned;
        var cancellation = parent ? sourceCancel / Math.max(1, children.length) : sourceCancel;
        if(cancelled){fee=0;freight=0;rebate=0;discount=0;cancellation=cancellation||-faturamento;}
        if(returned){fee=0;rebate=0;discount=0;cancellation=cancellation||-faturamento;}
        var liquid = faturamento + fee + freight + rebate + discount + cancellation;
        var tax = inactive?0:(-faturamento - discount) * (num(channel.taxRate) / 100), sku = String(r[ix.sku] || '').trim();
        var cmv = inactive?0:-(costMap[sku] || 0) * units, gm = liquid + tax + cmv, date = selectedDate(r[ix.date], selectedMonth);
        if (!date) throw new Error('Data inválida na linha ' + item.line + '.');
        output.push(['Mercado Livre',channel.channelName,String(r[ix.sale] || '').replace(/\.0$/, ''),r[ix.date],date,r[ix.state],saleStatus,r[ix.delivery],r[ix.ad],title,sku,price,units,faturamento,discount,rebate,fee,freight,cancellation,liquid,0,tax,cmv,gm,faturamento ? gm / faturamento : 0,id]);
      });
    });
    if (output.length === 1) throw new Error('Nenhuma venda válida foi encontrada no relatório.');
    return output;
  }

  async function transformShopee(file, channel) {
    var workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    var sheet = workbook.Sheets.orders;
    if (!sheet) throw new Error("O arquivo da Shopee precisa conter a aba 'orders'.");
    var matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (matrix.length < 2) throw new Error("A aba 'orders' não contém linhas de pedidos.");
    var response = await fetch('/api/sales-treaters/shopee-transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: channel.id, headers: matrix[0], rows: matrix.slice(1) })
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível tratar o relatório da Shopee.');
    return { rows: [result.headers].concat(result.rows), summary: result.summary || {} };
  }

  function workbookMatrix(file, preferredSheet) {
    return file.arrayBuffer().then(function(buffer){
      var workbook=XLSX.read(buffer,{type:'array',cellDates:true});
      var name=preferredSheet&&workbook.SheetNames.find(function(sheet){return norm(sheet)===norm(preferredSheet);})||workbook.SheetNames[0];
      if(!name)throw new Error('Nenhuma planilha foi encontrada em '+file.name+'.');
      return XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true});
    });
  }
  function parseDelimited(textValue, delimiter) {
    var textContent=String(textValue||'').replace(/^\uFEFF/,'');
    var separator=delimiter||((textContent.match(/\t/g)||[]).length>(textContent.match(/,/g)||[]).length?'\t':',');
    var rows=[],row=[],cell='',quoted=false;
    for(var i=0;i<textContent.length;i+=1){var ch=textContent[i];if(ch==='"'){if(quoted&&textContent[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;}else if(ch===separator&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&textContent[i+1]==='\n')i+=1;row.push(cell);if(row.some(function(v){return String(v).trim();}))rows.push(row);row=[];cell='';}else cell+=ch;}
    row.push(cell);if(row.some(function(v){return String(v).trim();}))rows.push(row);return rows;
  }
  function matrixPayload(matrix,prefix){if(!matrix||matrix.length<2)throw new Error('O relatório '+(prefix||'selecionado')+' não contém dados.');var result={},head=prefix?prefix+'Headers':'headers',rows=prefix?prefix+'Rows':'rows';result[head]=matrix[0];result[rows]=matrix.slice(1);return result;}
  async function postTransform(path,payload){var response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível tratar o relatório.');return {rows:[result.headers].concat(result.rows),summary:result.summary||{}};}
  function columnIndex(reference){var letters=String(reference||'').toUpperCase().match(/[A-Z]+/),index=0;if(!letters)return 0;for(var i=0;i<letters[0].length;i+=1)index=index*26+letters[0].charCodeAt(i)-64;return index-1;}
  async function tiktokMatrix(file){var buffer=await file.arrayBuffer(),workbook=XLSX.read(buffer,{type:'array',cellDates:true}),name=workbook.SheetNames.find(function(sheet){return norm(sheet)==='orderskulist';})||workbook.SheetNames[0],matrix=name?XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true}):[];if(matrix[0]&&matrix[0].length>1&&find(matrix[0],['Order ID'])>=0)return matrix;var archive=XLSX.CFB.read(new Uint8Array(buffer),{type:'array'}),candidates=[];archive.FullPaths.forEach(function(pathName,index){if(/xl[\\/]worksheets[\\/].+\.xml$/i.test(pathName)){var entry=archive.FileIndex[index];if(entry&&entry.content)candidates.push(entry.content);}});if(!candidates.length)throw new Error('O arquivo TikTok não contém uma planilha de pedidos.');var content=candidates.sort(function(a,b){return b.length-a.length;})[0],xml=new TextDecoder('utf-8').decode(content),documentXml=new DOMParser().parseFromString(xml,'application/xml'),values={};Array.from(documentXml.getElementsByTagNameNS('*','c')).forEach(function(cell){var reference=cell.getAttribute('r')||'',match=reference.match(/\d+/);if(!match)return;var row=Number(match[0])-1,column=columnIndex(reference),child=cell.getElementsByTagNameNS('*','t')[0]||cell.getElementsByTagNameNS('*','v')[0];if(!values[row])values[row]={};values[row][column]=child?child.textContent:'';});var rowNumbers=Object.keys(values).map(Number),maxRow=Math.max.apply(Math,rowNumbers),maxColumn=0;rowNumbers.forEach(function(row){Object.keys(values[row]).forEach(function(column){maxColumn=Math.max(maxColumn,Number(column));});});matrix=[];for(var r=0;r<=maxRow;r+=1){var current=[];for(var c=0;c<=maxColumn;c+=1)current.push(values[r]&&values[r][c]!=null?values[r][c]:'');matrix.push(current);}return matrix;}
  async function transformTikTok(file,channel){var matrix=await tiktokMatrix(file);return postTransform('/api/sales-treaters/tiktok-transform',Object.assign({channelId:channel.id},matrixPayload(matrix,'')));}
  async function transformAmazon(files,channel){
    var sales=parseDelimited(await files.sales.text(),'\t');
    var unifiedText=await files.unified.text(),unifiedLines=unifiedText.replace(/^\uFEFF/,'').split(/\r?\n/),headerIndex=unifiedLines.findIndex(function(line){return norm(line.replace(/^"/,'' )).indexOf('data/hora')===0;});
    if(headerIndex<0)throw new Error('Cabeçalho do relatório unificado da Amazon não encontrado.');
    var unified=parseDelimited(unifiedLines.slice(headerIndex).join('\n'),',');
    var receivable=parseDelimited(await files.receivable.text(),',');
    return postTransform('/api/sales-treaters/amazon-transform',Object.assign({channelId:channel.id},matrixPayload(sales,'sales'),matrixPayload(unified,'unified'),matrixPayload(receivable,'receivable')));
  }
  function zipCsvMatrices(file){return file.arrayBuffer().then(function(buffer){var archive=XLSX.CFB.read(new Uint8Array(buffer),{type:'array'}),result={};archive.FullPaths.forEach(function(fullPath,index){var name=String(fullPath||'').replace(/^Root Entry\//,'').replace(/\\/g,'/'),entry=archive.FileIndex[index];if(!entry||!entry.content||!name.toLowerCase().endsWith('.csv'))return;var decoded=new TextDecoder('utf-8').decode(entry.content);if(/pedidos/i.test(name))result.orders=parseDelimited(decoded,',');if(/pacotes/i.test(name))result.packages=parseDelimited(decoded,',');});if(!result.orders||!result.packages)throw new Error('O ZIP do Magalu deve conter um CSV de pedidos e um CSV de pacotes.');return result;});}
  async function transformMagalu(file,channel){var matrices=await zipCsvMatrices(file);return postTransform('/api/sales-treaters/magalu-transform',Object.assign({channelId:channel.id},matrixPayload(matrices.orders,'order'),matrixPayload(matrices.packages,'package')));}

  async function save(payload) { var response = await fetch('/api/sales-treaters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); var result=await response.json(); if(!response.ok) throw new Error(result.error||'Não foi possível salvar.'); state=result; render(); }
  async function recordTreatment(payload) { var response=await fetch('/api/sales-treaters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});var result=await response.json();if(!response.ok)throw new Error(result.error||'Nao foi possivel registrar o tratamento.');state=result;return result; }
  async function applyFreightAgreements(rows){
    var response=await fetch('/api/freight-agreements/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:rows})});
    var result=await response.json();
    if(!response.ok)throw new Error(result.error||'Não foi possível aplicar o Frete a Combinar.');
    return result;
  }
  function repriceTreatedRows(rows,costMap){
    if(!Array.isArray(rows)||rows.length<2)return rows;
    var headers=rows[0]||[];
    var skuIndex=find(headers,['Número de referência SKU','Numero de referencia SKU','SKU']);
    var quantityIndex=find(headers,['Quantidade','Unidades']);
    var costIndex=find(headers,['Custo do produto','CMV']);
    var gmIndex=find(headers,['Gross margen','Gross margin','GM']);
    var gmPercentIndex=find(headers,['Gross margen %','Gross margin %','GM %']);
    var liquidIndex=find(headers,['Liquido','Líquido']);
    var taxIndex=find(headers,['Imposto']);
    var revenueIndex=find(headers,['Faturamento']);
    var statusIndex=find(headers,['Type.1','Status','Status do pedido','Estado']);
    if(skuIndex<0||quantityIndex<0||costIndex<0)return rows;
    return [headers].concat(rows.slice(1).map(function(sourceRow){
      var row=sourceRow.slice(),sku=String(row[skuIndex]||'').trim(),status=norm(statusIndex>=0?row[statusIndex]:'');
      var inactive=/cancel|devolu|devolv|reembolso|retorn/.test(status);
      var hasCost=Object.prototype.hasOwnProperty.call(costMap,sku)&&Number.isFinite(Number(costMap[sku]));
      row[costIndex]=inactive?0:(hasCost?-Math.abs(Number(costMap[sku]))*Math.abs(num(row[quantityIndex])):'');
      if(gmIndex>=0)row[gmIndex]=row[costIndex]===''?'':num(liquidIndex>=0?row[liquidIndex]:0)+num(taxIndex>=0?row[taxIndex]:0)+num(row[costIndex]);
      if(gmPercentIndex>=0){
        var revenue=revenueIndex>=0?num(row[revenueIndex]):0;
        row[gmPercentIndex]=row[gmIndex]===''||!revenue?'':num(row[gmIndex])/revenue;
      }
      return row;
    }));
  }
  function appendCompatibleRows(target,rows){
    if(!rows||rows.length<2)return target;
    if(!target.length)target=[publishHeaders.slice()];
    var targetHeaders=target[0],sourceIndexes={};
    (rows[0]||[]).forEach(function(header,index){sourceIndexes[norm(header)]=index;});
    var aliases={
      'n.º de venda':['id do pedido'],
      'data da venda':['data completa'],
      'estado':['status do pedido'],
      'type.1':['status'],
      'forma de entrega':['opcao de envio'],
      '# de anuncio':['id do produto'],
      'titulo do anuncio':['nome do produto'],
      'sku':['numero de referencia sku'],
      'preco unitario de venda do anuncio (brl)':['preco acordado'],
      'unidades':['quantidade'],
      'gross margen':['gross margin'],
      'gross margen %':['gross margin %']
    };
    rows.slice(1).forEach(function(row){
      target.push(targetHeaders.map(function(header){
        var key=norm(header),index=sourceIndexes[key];
        if(index==null)(aliases[key]||[]).some(function(alias){index=sourceIndexes[norm(alias)];return index!=null;});
        return index==null?'':row[index];
      }));
    });
    return target;
  }
  async function refreshAllPublishedBases(button,status){
    if(!confirm('Retratar e republicar todos os meses de todas as contas? O CMV e a margem serao recalculados com o cadastro de custos atual.'))return;
    var password=prompt('Informe a senha administrativa para atualizar todas as bases:');
    if(password===null)return;
    if(!password)return alert('Informe a senha administrativa.');
    var original=button.textContent;
    try{
      button.disabled=true;button.textContent='Retratando...';status.textContent='Recuperando todos os meses tratados e recalculando o CMV...';
      var costMap=await costs(),combined=[],updatedMonths=0,updatedRows=0,seenRows=new Set();
      for(var channelIndex=0;channelIndex<state.channels.length;channelIndex+=1){
        var channel=state.channels[channelIndex],records=(channel.treatmentHistory||[]).filter(function(item){return item.storedName;});
        for(var recordIndex=0;recordIndex<records.length;recordIndex+=1){
          var item=records[recordIndex];
          status.textContent='Retratando '+channel.channelName+' · '+months[Number(item.month)-1]+'/'+item.year+'...';
          var response=await fetch('/api/sales-treaters/treated-rows?id='+encodeURIComponent(channel.id)+'&month='+encodeURIComponent(item.month)+'&year='+encodeURIComponent(item.year)+'&source=1',{cache:'no-store'});
          var result=await response.json();if(!response.ok)throw new Error(result.error||'Nao foi possivel recuperar o tratamento mensal.');
          var repriced=repriceTreatedRows(result.rows,costMap),freightResult=await applyFreightAgreements(repriced),adjusted=freightResult.rows,range=treatmentRange(adjusted);
          await recordTreatment({action:'record-treatment',id:channel.id,month:item.month,year:item.year,rowCount:adjusted.length-1,firstDate:range.firstDate,lastDate:range.lastDate,sourceFile:item.sourceFile||'',missingCostSkus:item.missingCostSkus||0,sourceRows:repriced,rows:adjusted});
          var uniqueRows=[adjusted[0]].concat(adjusted.slice(1).filter(function(row){
            var fingerprint=JSON.stringify(row);
            if(seenRows.has(fingerprint))return false;
            seenRows.add(fingerprint);return true;
          }));
          combined=appendCompatibleRows(combined,uniqueRows);updatedMonths+=1;updatedRows+=Math.max(0,uniqueRows.length-1);
        }
      }
      if(combined.length<2)throw new Error('Nenhum mes tratado com arquivo salvo foi encontrado.');
      if(!window.salesBaseIntegration)throw new Error('A integracao da Base de Vendas nao esta disponivel.');
      status.textContent='Gerando a base consolidada de todas as contas...';
      await window.salesBaseIntegration.prepareTreatedRows(combined,'Retratamento completo · '+updatedMonths+' meses');
      status.textContent='Criando backup e removendo as bases publicadas anteriormente...';
      var clearResponse=await fetch('/api/sales-treaters/clear-published',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify({confirm:true})});
      var clearResult=await clearResponse.json();if(!clearResponse.ok)throw new Error(clearResult.error||'Nao foi possivel substituir as bases anteriores.');
      status.textContent='Bases anteriores removidas. Publicando todos os meses e todas as contas...';
      var published=await window.salesBaseIntegration.publishPrepared(password,false);
      if(published===false)throw new Error('Nao foi possivel concluir a publicacao das bases.');
      status.textContent=updatedMonths+' tratamento(s), '+updatedRows.toLocaleString('pt-BR')+' vendas recalculadas e republicadas com o CMV atual. Backup: '+clearResult.backup+'.';
      alert('Atualizacao concluida. Todas as contas foram mantidas e o CMV foi recalculado em '+updatedMonths+' tratamento(s).');
    }catch(error){status.textContent=error.message;alert(error.message);}finally{button.disabled=false;button.textContent=original;}
  }
  function formatDateBr(value){var match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?match[3]+'/'+match[2]+'/'+match[1]:'—';}
  function formatDateTimeBr(value){var date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function historyHtml(channel){
    var history=Array.isArray(channel.treatmentHistory)?channel.treatmentHistory.slice():[];
    var currentYear=new Date().getFullYear(),years=Array.from(new Set([currentYear].concat(history.map(function(item){return Number(item.year)||currentYear;})))).sort(function(a,b){return b-a;});
    var groups=years.map(function(year){
      var cards=months.map(function(label,index){
        var item=history.find(function(record){return Number(record.year)===year&&Number(record.month)===index+1;});
        if(!item)return '<div class="treat-history-item pending"><b>'+label+' / '+year+'</b><span>Ainda não alimentado</span></div>';
        return '<div class="treat-history-item done"><b>'+label+' / '+year+'</b><span>'+Number(item.rowCount||0).toLocaleString('pt-BR')+' linhas</span><span>Datas no arquivo: '+formatDateBr(item.firstDate)+' a '+formatDateBr(item.lastDate)+'</span><small>'+(item.storedName?'Pronto para republicar · ':'Histórico sem arquivo salvo · ')+'Enviado em '+formatDateTimeBr(item.uploadedAt)+(item.sourceFile?' · '+esc(item.sourceFile):'')+'</small></div>';
      }).join('');
      return '<div class="treat-history-year"><strong>'+year+'</strong><div class="treat-history-grid">'+cards+'</div></div>';
    }).join('');
    return '<div class="treat-history" data-treatment-history><div class="treat-history-title"><strong>Controle mensal de arquivos</strong><small>'+history.length+' mês(es) alimentado(s)</small></div>'+groups+'</div>';
  }
  function treatmentRange(rows){var headers=rows[0]||[],dateIndex=find(headers,['Data','Data da venda']);if(dateIndex<0)dateIndex=find(headers,['Data Completa']);var dates=dateIndex<0?[]:rows.slice(1).map(function(row){return dateValue(row[dateIndex]);}).filter(Boolean).sort();return {firstDate:dates[0]||'',lastDate:dates[dates.length-1]||'',year:dates.length?Number(dates[0].slice(0,4)):new Date().getFullYear()};}
  function preparedMonths(channelId){return Object.keys(preparedRows[channelId]||{}).sort(function(a,b){return Number(a)-Number(b);});}
  function combinedPreparedRows(channelId){
    var monthKeys=preparedMonths(channelId),header=null,combined=[];
    monthKeys.forEach(function(monthKey){var rows=preparedRows[channelId][monthKey]||[];if(!header&&rows[0])header=rows[0];if(rows.length>1)combined=combined.concat(rows.slice(1));});
    return header&&combined.length?[header].concat(combined):null;
  }
  async function rowsForPublish(channel,scope){
    var records=(Array.isArray(channel.treatmentHistory)?channel.treatmentHistory:[]).filter(function(item){return item.storedName;});
    var currentYear=new Date().getFullYear(),session=preparedRows[channel.id]||{};
    Object.keys(session).forEach(function(monthValue){if(!records.some(function(item){return Number(item.year)===currentYear&&Number(item.month)===Number(monthValue);})){records.push({month:Number(monthValue),year:currentYear,sessionOnly:true});}});
    records.sort(function(a,b){return Number(a.year)-Number(b.year)||Number(a.month)-Number(b.month);});
    if(scope==='latest'&&records.length)records=[records[records.length-1]];
    if(!records.length)throw new Error('Os meses exibidos no histórico antigo não possuem dados tratados salvos. Trate novamente o mês desejado.');
    var header=null,combined=[],labels=[];
    for(var index=0;index<records.length;index+=1){
      var item=records[index],rows=Number(item.year)===currentYear&&session[String(Number(item.month))];
      if(!rows){var response=await fetch('/api/sales-treaters/treated-rows?id='+encodeURIComponent(channel.id)+'&month='+encodeURIComponent(item.month)+'&year='+encodeURIComponent(item.year),{cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível recuperar '+months[Number(item.month)-1]+'/'+item.year+'.');rows=result.rows;}
      if(!header&&rows[0])header=rows[0];if(rows.length>1)combined=combined.concat(rows.slice(1));labels.push(months[Number(item.month)-1]+'/'+item.year);
    }
    return {rows:header&&combined.length?[header].concat(combined):null,labels:labels};
  }
  function downloadTreated(rows,channel,month){
    var sheet=XLSX.utils.aoa_to_sheet(rows), workbook=XLSX.utils.book_new();
    sheet['!autofilter']={ref:sheet['!ref']};
    sheet['!freeze']={xSplit:0,ySplit:1};
    sheet['!cols']=rows[0].map(function(header,index){return {wch:index===9?42:index===5?30:index<2?18:16};});
    XLSX.utils.book_append_sheet(workbook,sheet,'DB');
    var safeName=String(channel.channelName||channel.marketplace).replace(/[\\/:*?"<>|]+/g,'-');
    var suffix=months[Number(month)-1]||channel.marketplace;
    XLSX.writeFile(workbook,'RESUMO VENDAS E VARIAÇÃO - '+safeName+' - '+suffix+'.xlsx');
  }
  function render() {
    var marketplaceOptions=['Mercado Livre','Shopee','TikTok','Amazon','Magalu'].map(function(name){return '<option>'+name+'</option>';}).join('');
    function uploads(channel){var key=norm(channel.marketplace);if(key==='amazon')return '<div class="treat-multi-upload"><label class="treat-upload">Pedidos TXT<input type="file" accept=".txt,.tsv" data-file-kind="sales"></label><label class="treat-upload">Relatório unificado CSV<input type="file" accept=".csv,.txt" data-file-kind="unified"></label><label class="treat-upload">Transações a receber CSV<input type="file" accept=".csv,.txt" data-file-kind="receivable"></label></div>';if(key==='magalu')return '<label class="treat-upload">Selecionar ZIP original Magalu<input type="file" accept=".zip" data-file-kind="raw"></label>';return '<label class="treat-upload">Selecionar relatório bruto '+esc(channel.marketplace)+'<input type="file" accept="'+(key==='mercado livre'?'.xlsx,.xls':'.xlsx')+'" data-file-kind="raw"></label>';}
    container.innerHTML='<div class="treat-shell"><div class="treat-head"><div><span>CONFIGURAÇÃO · VENDAS</span><h2>Tratador de Vendas</h2><p>Cadastre cada canal, selecione a competência e acompanhe os meses já alimentados.</p></div><div class="treat-head-actions"><form id="treatChannelForm"><select name="marketplace">'+marketplaceOptions+'</select><input name="channelName" required placeholder="Nome do canal / empresa"><input name="taxRate" type="number" min="0" max="100" step=".01" value="14" required placeholder="Imposto %"><label class="treat-shopee-param" hidden><span>Antecipação %</span><input name="anticipationRate" type="number" min="0" max="100" step=".01" value="2.5"></label><label class="treat-shopee-param" hidden><span>Frete</span><input name="freight" type="number" step=".01" value="0"></label><button>Adicionar canal</button></form><div class="treat-refresh-row"><button type="button" data-refresh-all>Atualizar todas as bases</button><small data-refresh-status>Preserva os meses publicados e cria backup automático.</small></div></div></div><section class="treat-list">'+(state.channels.length?state.channels.map(function(channel){var key=norm(channel.marketplace),direct=key!=='mercado livre',hasSaved=(channel.treatmentHistory||[]).some(function(item){return item.storedName;});return '<article data-channel="'+channel.id+'" data-marketplace="'+esc(channel.marketplace)+'"><div class="treat-channel"><b>'+esc(channel.marketplace)+'</b><strong>'+esc(channel.channelName)+'</strong><small>Imposto: '+num(channel.taxRate).toLocaleString('pt-BR')+'%'+(key==='shopee'?' · Antecipação: '+num(channel.anticipationRate).toLocaleString('pt-BR')+'% · Frete: '+num(channel.freight).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'')+'</small></div><label class="treat-month"><span>Mês da venda</span><select data-sale-month>'+months.map(function(m,i){return '<option value="'+(i+1)+'"'+(i===new Date().getMonth()?' selected':'')+'>'+m+'</option>';}).join('')+'</select></label>'+uploads(channel)+'<button data-treat disabled>'+(direct?'Tratar e baixar XLSX':'Tratar arquivo')+'</button>'+(direct?'':'<select class="treat-publish-scope" data-publish-scope><option value="all">Todos os meses tratados</option><option value="latest">Somente o último mês</option></select><button class="primary" data-publish'+(hasSaved?'':' disabled')+'>Enviar para Subir Base de Vendas</button>')+'<button class="danger" data-delete>Excluir canal</button><div class="treat-status">Aguardando relatório.</div>'+historyHtml(channel)+'</article>';}).join(''):'<div class="treat-empty">Adicione o primeiro canal de marketplace.</div>')+'</section></div>';
    var form=document.getElementById('treatChannelForm'),marketplace=form.elements.marketplace;
    function updateForm(){var shopee=norm(marketplace.value)==='shopee';form.querySelectorAll('.treat-shopee-param').forEach(function(field){field.hidden=!shopee;});form.elements.anticipationRate.required=shopee;form.elements.freight.required=shopee;}
    marketplace.addEventListener('change',updateForm);updateForm();
    var refreshButton=container.querySelector('[data-refresh-all]'),refreshStatus=container.querySelector('[data-refresh-status]');
    if(refreshButton)refreshButton.addEventListener('click',function(){refreshAllPublishedBases(refreshButton,refreshStatus);});
    form.addEventListener('submit',function(e){e.preventDefault();save({action:'upsert-channel',marketplace:e.target.marketplace.value,channelName:e.target.channelName.value,taxRate:num(e.target.taxRate.value),anticipationRate:num(e.target.anticipationRate.value),freight:num(e.target.freight.value)}).catch(function(err){alert(err.message);});});
    container.querySelectorAll('[data-channel]').forEach(function(card){var channel=state.channels.find(function(x){return x.id===card.dataset.channel;}),inputs=Array.from(card.querySelectorAll('[data-file-kind]')),treat=card.querySelector('[data-treat]'),publish=card.querySelector('[data-publish]'),scope=card.querySelector('[data-publish-scope]'),status=card.querySelector('.treat-status');function ready(){var ok=inputs.every(function(input){return input.files[0];});treat.disabled=!ok;status.textContent=ok?'Relatórios prontos para tratar.':'Aguardando relatório.';}inputs.forEach(function(input){input.addEventListener('change',ready);});if(publish)publish.addEventListener('click',async function(){var original=publish.textContent;try{publish.disabled=true;publish.textContent='Preparando...';status.textContent='Recuperando os meses tratados do disco...';var prepared=await rowsForPublish(channel,scope?scope.value:'all');if(!prepared.rows)throw new Error('Nenhuma linha tratada foi encontrada.');var name='RESUMO VENDAS E VARIAÇÃO - '+channel.channelName+' - '+prepared.labels.join(', ')+'.xlsx',staged=window.salesBaseIntegration.stageTreatedRows(prepared.rows,name);if(!staged)throw new Error('Não foi possível preparar a segunda etapa.');status.textContent=prepared.labels.length+' mês(es) enviados para Subir Base de Vendas: '+prepared.labels.join(', ')+'. Nenhum dado foi publicado ainda.';var destination=document.querySelector('[data-tab="salesUploadPanel"]');if(destination)destination.click();}catch(error){status.textContent=error.message;alert(error.message);}finally{publish.disabled=false;publish.textContent=original;}});card.querySelector('[data-delete]').addEventListener('click',function(){if(confirm('Excluir o canal '+channel.channelName+'?'))save({action:'delete-channel',id:channel.id}).catch(function(err){alert(err.message);});});});
  }
  document.addEventListener('click',async function(event){
    var treat=event.target.closest('[data-treat]');
    var currentContainer=document.getElementById('salesTreatersContainer');
    if(!treat||!currentContainer||!currentContainer.contains(treat))return;
    var card=treat.closest('[data-channel]'), channel=state.channels.find(function(item){return item.id===card.dataset.channel;});
    var inputs=Array.from(card.querySelectorAll('[data-file-kind]')), month=card.querySelector('[data-sale-month]'), publish=card.querySelector('[data-publish]'), status=card.querySelector('.treat-status');
    if(!channel||inputs.some(function(input){return !input.files[0];}))return;
    try{
      var key=norm(channel.marketplace),files={};inputs.forEach(function(input){files[input.dataset.fileKind]=input.files[0];});
      treat.disabled=true;status.textContent='Tratando vendas, custos e margem de '+channel.marketplace+'...';
      var result=key==='shopee'?await transformShopee(files.raw,channel):key==='tiktok'?await transformTikTok(files.raw,channel):key==='amazon'?await transformAmazon(files,channel):key==='magalu'?await transformMagalu(files.raw,channel):{rows:await transform(files.raw,channel,month.value),summary:{}};
      var rows=result.rows;
      var unitsOutputIndex=find(rows[0],['Unidades']);
      rows=[rows[0]].concat(rows.slice(1).filter(function(row){return unitsOutputIndex<0||typeof row[unitsOutputIndex]==='number';}));
      var sourceRows=rows.map(function(row){return row.slice();}),freightResult=await applyFreightAgreements(sourceRows);
      rows=freightResult.rows;
      preparedRows[channel.id]=preparedRows[channel.id]||{};preparedRows[channel.id][month.value]=rows;if(publish)publish.disabled=false;
      if(key!=='mercado livre')downloadTreated(rows,channel,month.value);
      var range=treatmentRange(rows),sourceFile=inputs.map(function(input){return input.files[0]&&input.files[0].name;}).filter(Boolean).join(' + ');
      await recordTreatment({action:'record-treatment',id:channel.id,month:month.value,year:range.year,rowCount:rows.length-1,firstDate:range.firstDate,lastDate:range.lastDate,sourceFile:sourceFile,missingCostSkus:num(result.summary.missingCostSkus),sourceRows:sourceRows,rows:rows});
      var updatedChannel=state.channels.find(function(item){return item.id===channel.id;}),historyBox=card.querySelector('[data-treatment-history]');if(historyBox&&updatedChannel)historyBox.outerHTML=historyHtml(updatedChannel);
      var readyLabels=preparedMonths(channel.id).map(function(value){return months[Number(value)-1];}).join(', ');
      var freightText=freightResult.summary.adjustedOrders?' · '+freightResult.summary.adjustedOrders.toLocaleString('pt-BR')+' venda(s) com Frete a Combinar':'';
      status.textContent=key!=='mercado livre'?(rows.length-1).toLocaleString('pt-BR')+' linhas processadas · '+num(result.summary.missingCostSkus).toLocaleString('pt-BR')+' SKU(s) sem custo'+freightText+' · XLSX baixado e mês registrado.':(rows.length-1).toLocaleString('pt-BR')+' vendas tratadas para '+months[Number(month.value)-1]+freightText+' · meses prontos para envio conjunto: '+readyLabels+'.';
    }catch(err){status.textContent=err.message;}finally{treat.disabled=false;}
  });
  fetch('/api/sales-treaters',{cache:'no-store'}).then(function(r){return r.json();}).then(function(data){state=data;render();}).catch(function(e){container.textContent=e.message;});
})();
