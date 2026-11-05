(() => {
 const $ = id => document.getElementById(id);
 const api = path => fetch('/api/tratocap/' + path, { headers: { Accept: 'application/json' } }).then(async r => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.erro || body.error || ('HTTP ' + r.status));
  return body;
 });
 const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function renderAlbums(target, state, albums, emptyText, isGallery=false) {
  const list=$(target), msg=$(state);
  if (!Array.isArray(albums) || albums.length===0) {
   msg.textContent=emptyText; msg.hidden=false; list.innerHTML=''; return;
  }
  msg.hidden=true;
  list.innerHTML=albums.map(a=>{
   const name=escapeHtml(a.album || 'Álbum sem nome');
   const count=Number(a.images)||0;
   const imported=isGallery || Boolean(a.imported);
   return '<article class="tc-album"><h4>'+name+'</h4><p>'+count+' foto(s) recebida(s)</p><span class="tc-album-tag">'+(isGallery?'NA GALERIA':(imported?'IMPORTADO':'AGUARDANDO IMPORTAÇÃO'))+'</span></article>';
  }).join('');
 }
 async function refresh(){
  $('refreshBtn').disabled=true; $('refreshBtn').textContent='Atualizando…';
  try {
   const status=await api('status');
   $('serverBadge').textContent=status.status==='online'?'Servidor online · v'+escapeHtml(status.versao):'Servidor indisponível';
   $('serverBadge').className='tc-badge '+(status.status==='online'?'tc-online':'tc-offline');
  } catch(e) {
   $('serverBadge').textContent='Falha ao consultar servidor'; $('serverBadge').className='tc-badge tc-offline';
  }
  try {
   const data=await api('albums');
   const albums=Array.isArray(data.albums)?data.albums:[];
   $('albumCount').textContent=albums.length;
   $('photoCount').textContent=albums.reduce((n,a)=>n+(Number(a.images)||0),0);
   $('importedCount').textContent=albums.filter(a=>a.imported).length;
   renderAlbums('albumsList','albumsState',albums,'Nenhum álbum recebido ainda.');
  } catch(e) {
   $('albumsState').hidden=false; $('albumsState').textContent='Não foi possível carregar os álbuns: '+e.message;
   $('albumsList').innerHTML=''; $('albumCount').textContent='—'; $('photoCount').textContent='—'; $('importedCount').textContent='—';
  }
  try {
   const data=await api('gallery');
   renderAlbums('galleryList','galleryState',data.gallery||[],'Nenhum álbum na galeria.',true);
  } catch(e) {
   $('galleryState').hidden=false; $('galleryState').textContent='Não foi possível carregar a galeria: '+e.message;
   $('galleryList').innerHTML='';
  }
  $('refreshBtn').disabled=false; $('refreshBtn').textContent='Atualizar dados';
 }
 $('refreshBtn').addEventListener('click',refresh);
 refresh();
})();