(function(){
  'use strict';
  var container=document.getElementById('freightAgreementContainer');
  if(!container)return;
  var state={entries:{},updatedAt:null,search:'',page:1,pageSize:100,file:null,preview:[],message:'',error:''};

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function norm(value){return String(value==null?'':value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[º°]/g,'');}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function numberValue(value){
    if(typeof value==='number')return Number.isFinite(value)?value:NaN;
    var text=String(value==null?'':value).replace(/R\$/gi,'').replace(/\s/g,'');
    if(text.indexOf(',')>=0)text=text.replace(/\./g,'').replace(',','.');
    return Number(text);
  }
  function saleNumber(value){return String(value==null?'':value).trim().replace(/\.0$/,'');}
  function rowsList(){
    var search=norm(state.search);
    return Object.keys(state.entries).map(function(key){return Object.assign({saleNumber:key},state.entries[key]);})
      .filter(function(item){return !search||norm(item.saleNumber).includes(search)||norm(item.sourceFile).includes(search);})
      .sort(function(a,b){return String(a.saleNumber).localeCompare(String(b.saleNumber),'pt-BR',{numeric:true});});
  }
  function render(){
    var rows=rowsList(),pages=Math.max(1,Math.ceil(rows.length/state.pageSize));if(state.page>pages)state.page=pages;
    var start=(state.page-1)*state.pageSize,current=rows.slice(start,start+state.pageSize);
    var body=current.map(function(item){return '<tr><td>'+esc(item.saleNumber)+'</td><td>'+money(item.value)+'</td><td>'+esc(item.sourceFile||'—')+'</td><td>'+esc(item.importedAt?new Date(item.importedAt).toLocaleString('pt-BR'):'—')+'</td><td><button type="button" data-delete="'+esc(item.saleNumber)+'">Excluir</button></td></tr>';}).join('');
    var preview=state.preview.length?'<div class="freight-preview"><strong>'+state.preview.length.toLocaleString('pt-BR')+' venda(s) válida(s) encontradas</strong><span>Total pago por fora: '+money(state.preview.reduce(function(sum,item){return sum+item.value;},0))+'</span></div>':'';
    container.innerHTML='<div class="freight-shell">'+
      '<section class="freight-hero"><div><span>Configuração · Vendas</span><h2>Frete a Combinar</h2><p>Importe uma planilha com as colunas <b>N.º de venda</b> e <b>Valor</b>. O valor pago por fora será abatido do Frete e recalculará Líquido, Margem e Margem %.</p></div><div class="freight-formula"><b>Regra aplicada</b><span>Frete final = Frete da plataforma − Valor pago por fora</span></div></section>'+
      '<section class="freight-upload-card"><label class="freight-drop">Selecionar planilha de fretes<input id="freightFile" type="file" accept=".xlsx,.xls,.csv"></label><label>Modo de importação<select id="freightMode"><option value="merge">Adicionar e atualizar vendas do arquivo</option><option value="replace">Substituir toda a tabela atual</option></select></label><label>Senha administrativa<input id="freightPassword" type="password" placeholder="Informe a senha"></label><button id="freightRead" type="button">Ler e conferir</button><button id="freightImport" class="primary" type="button" '+(state.preview.length?'':'disabled')+'>Salvar tabela</button></section>'+preview+
      (state.error?'<div class="freight-message error">'+esc(state.error)+'</div>':state.message?'<div class="freight-message">'+esc(state.message)+'</div>':'')+
      '<section class="freight-table-card"><div class="freight-table-head"><div><h3>Fretes cadastrados</h3><span>'+Object.keys(state.entries).length.toLocaleString('pt-BR')+' venda(s) · Total '+money(Object.keys(state.entries).reduce(function(sum,key){return sum+Number(state.entries[key].value||0);},0))+'</span></div><div><input id="freightSearch" value="'+esc(state.search)+'" placeholder="Pesquisar número da venda"><button id="freightClear" type="button" '+(Object.keys(state.entries).length?'':'disabled')+'>Limpar tabela</button></div></div>'+
      '<div class="freight-table-wrap"><table><thead><tr><th>N.º de venda</th><th>Valor pago por fora</th><th>Arquivo</th><th>Importado em</th><th>Ação</th></tr></thead><tbody>'+(body||'<tr><td colspan="5" class="empty">Nenhum frete cadastrado.</td></tr>')+'</tbody></table></div>'+
      '<div class="freight-pagination"><span>Linhas '+(rows.length?start+1:0)+' a '+Math.min(start+state.pageSize,rows.length)+' · Página '+state.page+' de '+pages+'</span><div><button id="freightPrevious" '+(state.page<=1?'disabled':'')+'>Anterior</button><button id="freightNext" '+(state.page>=pages?'disabled':'')+'>Próxima</button><select id="freightPageSize"><option value="100" '+(state.pageSize===100?'selected':'')+'>100 linhas</option><option value="300" '+(state.pageSize===300?'selected':'')+'>300 linhas</option><option value="1000" '+(state.pageSize===1000?'selected':'')+'>1.000 linhas</option></select></div></div></section>'+
      '<section class="freight-note"><b>Importante</b><span>Depois de alterar esta tabela, use <b>Atualizar todas as bases</b> no Tratador de Vendas para recalcular os meses que já foram tratados e publicados.</span></section></div>';
    bind();
  }
  function bind(){
    var file=document.getElementById('freightFile');if(file)file.onchange=function(){state.file=this.files[0]||null;state.preview=[];state.error='';state.message='';};
    var read=document.getElementById('freightRead');if(read)read.onclick=readFile;
    var save=document.getElementById('freightImport');if(save)save.onclick=savePreview;
    var search=document.getElementById('freightSearch');if(search)search.oninput=function(){state.search=this.value;state.page=1;render();var replacement=document.getElementById('freightSearch');if(replacement){replacement.focus();replacement.setSelectionRange(state.search.length,state.search.length);}};
    var previous=document.getElementById('freightPrevious');if(previous)previous.onclick=function(){state.page-=1;render();};
    var next=document.getElementById('freightNext');if(next)next.onclick=function(){state.page+=1;render();};
    var pageSize=document.getElementById('freightPageSize');if(pageSize)pageSize.onchange=function(){state.pageSize=Number(this.value);state.page=1;render();};
    container.querySelectorAll('[data-delete]').forEach(function(button){button.onclick=function(){mutate({action:'delete',saleNumber:this.dataset.delete});};});
    var clear=document.getElementById('freightClear');if(clear)clear.onclick=function(){if(confirm('Apagar todos os fretes cadastrados?'))mutate({action:'clear'});};
  }
  function extractEntries(matrix){
    var headerRow=-1,saleIndex=-1,valueIndex=-1;
    for(var rowIndex=0;rowIndex<Math.min(40,matrix.length);rowIndex+=1){
      var row=matrix[rowIndex]||[];
      var candidateSale=row.findIndex(function(value){var key=norm(value);return key==='n. de venda'||key==='n de venda'||key==='numero de venda'||key==='n. venda';});
      var candidateValue=row.findIndex(function(value){var key=norm(value);return key==='valor'||key==='valor pago'||key==='frete pago'||key==='valor do frete';});
      if(candidateSale>=0&&candidateValue>=0){headerRow=rowIndex;saleIndex=candidateSale;valueIndex=candidateValue;break;}
    }
    if(headerRow<0)throw new Error('Não encontrei as colunas N.º de venda e Valor na planilha.');
    var totals={};
    matrix.slice(headerRow+1).forEach(function(row){
      var sale=saleNumber(row[saleIndex]),value=numberValue(row[valueIndex]);
      if(!sale||!Number.isFinite(value)||value===0)return;
      totals[sale]=(totals[sale]||0)+Math.abs(value);
    });
    return Object.keys(totals).map(function(sale){return{saleNumber:sale,value:Math.round(totals[sale]*100)/100};});
  }
  async function readFile(){
    var input=document.getElementById('freightFile'),file=input&&input.files[0];
    if(!file){state.error='Selecione uma planilha para continuar.';render();return;}
    try{
      var workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
      var sheet=workbook.Sheets[workbook.SheetNames[0]],matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
      state.file=file;state.preview=extractEntries(matrix);state.error='';state.message='Arquivo conferido. Revise o total e clique em Salvar tabela.';
    }catch(error){state.preview=[];state.message='';state.error=error.message;}
    render();
  }
  async function savePreview(){
    var password=document.getElementById('freightPassword').value,mode=document.getElementById('freightMode').value;
    if(!password){state.error='Informe a senha administrativa.';render();return;}
    await mutate({action:'import',entries:state.preview,sourceFile:state.file&&state.file.name||'',replace:mode==='replace'},password);
    state.preview=[];state.file=null;
  }
  async function mutate(payload,password){
    if(!password)password=prompt('Informe a senha administrativa:');
    if(password===null)return;
    try{
      var response=await fetch('/api/freight-agreements',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':password},body:JSON.stringify(payload)});
      var result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível salvar.');
      state.entries=result.entries||{};state.updatedAt=result.updatedAt;state.error='';state.message='Tabela de Frete a Combinar atualizada com sucesso.';state.page=1;
    }catch(error){state.error=error.message;state.message='';}
    render();
  }
  async function load(){
    try{var response=await fetch('/api/freight-agreements',{cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível carregar.');state.entries=result.entries||{};state.updatedAt=result.updatedAt;}catch(error){state.error=error.message;}render();
  }
  load();
})();
