(function(){
  'use strict';
  var container=document.getElementById('salesTreatedBaseContainer');
  if(!container)return;
  var state={channels:[],channelId:'',period:'',headers:[],rows:[],filters:[],search:'',page:1,pageSize:100,loading:false,error:''};
  var months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function currentChannel(){return state.channels.find(function(item){return item.id===state.channelId;});}
  function history(){var channel=currentChannel();return channel&&Array.isArray(channel.treatmentHistory)?channel.treatmentHistory.filter(function(item){return item.storedName;}):[];}
  function periodKey(item){return item.year+'-'+String(item.month).padStart(2,'0');}
  function periodLabel(item){return months[Number(item.month)-1]+'/'+item.year+' · '+Number(item.rowCount||0).toLocaleString('pt-BR')+' linhas';}
  function normalized(value){return String(value==null?'':value).trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
  function filteredRows(){
    var search=normalized(state.search);
    return state.rows.filter(function(row){
      if(search&&!row.some(function(value){return normalized(value).includes(search);}))return false;
      return state.filters.every(function(filter,index){return !filter||normalized(row[index]).includes(normalized(filter));});
    });
  }
  function controlsHtml(){
    var channelOptions=state.channels.map(function(item){return '<option value="'+esc(item.id)+'" '+(item.id===state.channelId?'selected':'')+'>'+esc(item.marketplace+' · '+item.channelName)+'</option>';}).join('');
    var records=history().slice().sort(function(a,b){return Number(b.year)-Number(a.year)||Number(b.month)-Number(a.month);});
    var periodOptions='<option value="all" '+(state.period==='all'?'selected':'')+'>Todos os meses tratados</option>'+records.map(function(item){var key=periodKey(item);return '<option value="'+key+'" '+(key===state.period?'selected':'')+'>'+esc(periodLabel(item))+'</option>';}).join('');
    return '<section class="treated-sales-hero"><div><span>Configuração · Vendas</span><h2>Base Tratada de Vendas</h2><p>Consulte, filtre e confira cada coluna gerada pelo Tratador de Vendas.</p></div></section>'+
      '<section class="treated-sales-controls"><label class="treated-sales-field">Canal / empresa<select id="treatedSalesChannel">'+channelOptions+'</select></label>'+
      '<label class="treated-sales-field">Competência<select id="treatedSalesPeriod">'+periodOptions+'</select></label>'+
      '<label class="treated-sales-field search">Pesquisar em todas as colunas<input id="treatedSalesSearch" value="'+esc(state.search)+'" placeholder="Pedido, SKU, anúncio, produto..."></label>'+
      '<button class="treated-sales-button primary" id="treatedSalesLoad" type="button">'+(state.loading?'Carregando...':'Carregar base')+'</button>'+
      '<button class="treated-sales-button" id="treatedSalesClear" type="button">Limpar filtros</button></section>';
  }
  function tableHtml(){
    if(state.error)return '<div class="treated-sales-empty treated-sales-status error">'+esc(state.error)+'</div>';
    if(state.loading)return '<div class="treated-sales-empty">Carregando a base tratada...</div>';
    if(!state.headers.length)return '<div class="treated-sales-empty">Selecione o canal e a competência para consultar as vendas tratadas.</div>';
    var filtered=filteredRows(),pages=Math.max(1,Math.ceil(filtered.length/state.pageSize));
    if(state.page>pages)state.page=pages;
    var start=(state.page-1)*state.pageSize,pageRows=filtered.slice(start,start+state.pageSize);
    var head=state.headers.map(function(header){return '<th title="'+esc(header)+'">'+esc(header)+'</th>';}).join('');
    var filterHead=state.headers.map(function(header,index){return '<th><input data-column-filter="'+index+'" value="'+esc(state.filters[index]||'')+'" placeholder="Filtrar '+esc(header)+'"></th>';}).join('');
    var body=pageRows.map(function(row){return '<tr>'+state.headers.map(function(_,index){var value=row[index];return '<td title="'+esc(value)+'">'+esc(value)+'</td>';}).join('')+'</tr>';}).join('');
    return '<div class="treated-sales-summary"><span><b>'+filtered.length.toLocaleString('pt-BR')+'</b> linhas filtradas</span><span>de <b>'+state.rows.length.toLocaleString('pt-BR')+'</b> linhas carregadas</span><span><b>'+state.headers.length+'</b> colunas</span></div>'+
      '<section class="treated-sales-table-card"><div class="treated-sales-table-wrap"><table class="treated-sales-table"><thead><tr>'+head+'</tr><tr class="filters">'+filterHead+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
      '<div class="treated-sales-pagination"><span>Linhas '+(filtered.length?start+1:0)+' a '+Math.min(start+state.pageSize,filtered.length)+' · Página '+state.page+' de '+pages+'</span><div><button id="treatedSalesPrevious" '+(state.page<=1?'disabled':'')+'>Anterior</button><button id="treatedSalesNext" '+(state.page>=pages?'disabled':'')+'>Próxima</button><select id="treatedSalesPageSize"><option value="100" '+(state.pageSize===100?'selected':'')+'>100 linhas</option><option value="300" '+(state.pageSize===300?'selected':'')+'>300 linhas</option><option value="1000" '+(state.pageSize===1000?'selected':'')+'>1.000 linhas</option></select></div></div></section>';
  }
  function render(){
    container.innerHTML='<div class="treated-sales-shell">'+controlsHtml()+'<div id="treatedSalesResult">'+tableHtml()+'</div></div>';
    bind();
  }
  function renderResult(){var result=document.getElementById('treatedSalesResult');if(result){result.innerHTML=tableHtml();bindResult();}}
  function bind(){
    var channel=document.getElementById('treatedSalesChannel'),period=document.getElementById('treatedSalesPeriod'),search=document.getElementById('treatedSalesSearch');
    if(channel)channel.onchange=function(){state.channelId=this.value;var records=history().slice().sort(function(a,b){return Number(b.year)-Number(a.year)||Number(b.month)-Number(a.month);});state.period=records[0]?periodKey(records[0]):'';state.headers=[];state.rows=[];state.filters=[];state.page=1;render();};
    if(period)period.onchange=function(){state.period=this.value;};
    if(search)search.oninput=function(){state.search=this.value;state.page=1;renderResult();};
    var load=document.getElementById('treatedSalesLoad');if(load)load.onclick=loadRows;
    var clear=document.getElementById('treatedSalesClear');if(clear)clear.onclick=function(){state.search='';state.filters=state.headers.map(function(){return'';});state.page=1;render();};
    bindResult();
  }
  function bindResult(){
    Array.from(container.querySelectorAll('[data-column-filter]')).forEach(function(input){input.oninput=function(){
      var columnIndex=Number(this.dataset.columnFilter),cursor=this.selectionStart;
      state.filters[columnIndex]=this.value;state.page=1;renderResult();
      var replacement=container.querySelector('[data-column-filter="'+columnIndex+'"]');
      if(replacement){replacement.focus();if(typeof replacement.setSelectionRange==='function')replacement.setSelectionRange(cursor,cursor);}
    };});
    var previous=document.getElementById('treatedSalesPrevious');if(previous)previous.onclick=function(){state.page-=1;renderResult();};
    var next=document.getElementById('treatedSalesNext');if(next)next.onclick=function(){state.page+=1;renderResult();};
    var size=document.getElementById('treatedSalesPageSize');if(size)size.onchange=function(){state.pageSize=Number(this.value);state.page=1;renderResult();};
  }
  function appendRows(target,payload){
    var rows=payload&&Array.isArray(payload.rows)?payload.rows:[];
    if(rows.length<2)return target;
    if(!target.length)return rows.map(function(row){return row.slice();});
    var sourceHeaders=rows[0],indexes=target[0].map(function(header){return sourceHeaders.indexOf(header);});
    rows.slice(1).forEach(function(row){target.push(indexes.map(function(index){return index>=0?row[index]:'';}));});
    return target;
  }
  async function loadRows(){
    var records=history();
    if(!state.channelId||!records.length){state.error='Nenhuma base tratada foi encontrada para este canal.';renderResult();return;}
    var selected=state.period==='all'?records:records.filter(function(item){return periodKey(item)===state.period;});
    if(!selected.length){state.error='Selecione uma competência disponível.';renderResult();return;}
    state.loading=true;state.error='';render();
    try{
      var combined=[];
      for(var index=0;index<selected.length;index+=1){
        var item=selected[index];
        var response=await fetch('/api/sales-treaters/treated-rows?id='+encodeURIComponent(state.channelId)+'&month='+encodeURIComponent(item.month)+'&year='+encodeURIComponent(item.year),{cache:'no-store'});
        var result=await response.json();
        if(!response.ok)throw new Error(result.error||'Não foi possível carregar a base tratada.');
        combined=appendRows(combined,result.rows?result:{rows:[]});
      }
      state.headers=combined[0]||[];state.rows=combined.slice(1);state.filters=state.headers.map(function(){return'';});state.page=1;
    }catch(error){state.error=error.message;state.headers=[];state.rows=[];}finally{state.loading=false;render();}
  }
  async function loadState(){
    try{
      var response=await fetch('/api/sales-treaters',{cache:'no-store'}),result=await response.json();
      if(!response.ok)throw new Error(result.error||'Não foi possível carregar os canais.');
      state.channels=(result.channels||[]).filter(function(item){return Array.isArray(item.treatmentHistory)&&item.treatmentHistory.some(function(record){return record.storedName;});});
      state.channelId=state.channels[0]?state.channels[0].id:'';
      var records=history().slice().sort(function(a,b){return Number(b.year)-Number(a.year)||Number(b.month)-Number(a.month);});
      state.period=records[0]?periodKey(records[0]):'';
      render();
    }catch(error){state.error=error.message;render();}
  }
  document.querySelectorAll('[data-tab="salesTreatedBasePanel"]').forEach(function(button){button.addEventListener('click',function(){if(!state.channels.length)loadState();});});
  loadState();
})();
