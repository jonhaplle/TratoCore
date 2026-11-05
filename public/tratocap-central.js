(() => {
 const $ = id => document.getElementById(id);
 const api = (path, options={}) => fetch('/api/tratocap/' + path, {
  headers: { Accept: 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}) },
  ...options
 }).then(async r => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.erro || body.error || ('HTTP ' + r.status));
  return body;
 });
 const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function ensureLightbox(){
  if($('tcLightbox')) return;
  const box=document.createElement('div');
  box.id='tcLightbox'; box.className='tc-lightbox'; box.hidden=true;
  box.innerHTML='<button type="button" class="tc-lightbox-close" aria-label="Fechar">×</button><figure><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(box);
  box.addEventListener('click',e=>{if(e.target===box||e.target.closest('.tc-lightbox-close')) box.hidden=true;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape') box.hidden=true;});
 }
 function openPhoto(url,caption,name){
  ensureLightbox(); const box=$('tcLightbox');
  box.querySelector('img').src=url;
  box.querySelector('img').alt=name||'Foto do produto';
  box.querySelector('figcaption').textContent=caption||name||'';
  box.hidden=false;
 }
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
   const photos=Array.isArray(a.photos)?a.photos:[];
   const previews=photos.map(photo=>{
    const url=escapeHtml(photo.url);
    const alt=escapeHtml(photo.name || a.album || 'Foto do produto');
    const caption=escapeHtml(photo.note || '');
    return '<article class="tc-photo-card"><button class="tc-photo-open" type="button" data-photo-url="'+url+'" data-photo-caption="'+caption+'" data-photo-name="'+alt+'"><img class="tc-photo-thumb" src="'+url+'" alt="'+alt+'" loading="lazy"></button><div class="tc-photo-caption">'+(caption||'<span>Sem legenda</span>')+'</div></article>';
   }).join('');
   const action=isGallery?'':'<button class="tc-import-btn" type="button" data-import-album="'+name+'" '+(imported?'disabled':'')+'>'+(imported?'Produto criado':'Importar como produto')+'</button>';
   return '<section class="tc-album-section"><header class="tc-album-heading"><div><h4>'+name+'</h4><p>'+count+' foto(s)</p></div><span class="tc-album-tag">'+(isGallery?'NA GALERIA':(imported?'IMPORTADO':'AGUARDANDO IMPORTAÇÃO'))+'</span></header><div class="tc-photo-grid">'+(previews || '<span class="tc-no-photos">Nenhuma imagem encontrada neste álbum.</span>')+'</div>'+action+'</section>';
  }).join('');
 }
 async function refresh(){
  $('refreshBtn').disabled=true; $('refreshBtn').textContent='Atualizando…';
  try {
   const status=await api('status');
   $('serverBadge').textContent=status.status==='online'?'Servidor online · v'+escapeHtml(status.versao):'Servidor indisponível';
   $('serverBadge').className='tc-badge '+(status.status==='online'?'tc-online':'tc-offline');
   $('pendingSyncCount').textContent=Number(status.sync_queue?.pending || 0);
   $('syncedCount').textContent=Number(status.sync_queue?.synced || 0);
   $('failedSyncCount').textContent=Number(status.sync_queue?.failed || 0);
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
   const localData=await api('gallery');
   renderAlbums('localGalleryList','localGalleryState',localData.gallery||[],'Nenhum álbum na galeria local.',true);
  } catch(e) {
   $('localGalleryState').hidden=false;
   $('localGalleryState').textContent='Não foi possível carregar a galeria local: '+e.message;
   $('localGalleryList').innerHTML='';
  }
  try {
   const adminKey=sessionStorage.getItem('googleDriveAdminKey');
   if(!adminKey) throw new Error('Abra Configurar Google Drive, informe a chave administrativa e volte para esta página.');
   const response=await fetch('/api/tratocap/drive-gallery',{headers:{Accept:'application/json',Authorization:'Bearer '+adminKey}});
   const data=await response.json().catch(()=>({}));
   if(!response.ok) throw new Error(data.erro || data.error || ('HTTP '+response.status));
   renderAlbums('galleryList','galleryState',data.gallery||[],'Nenhum álbum encontrado na pasta FOTOS.',true);
  } catch(e) {
   $('galleryState').hidden=false; $('galleryState').textContent='Galeria permanente: '+e.message+' ';
   $('galleryList').innerHTML='';
   if(!document.querySelector('[data-drive-setup-link]')) {
    const link=document.createElement('a');
    link.href='google-drive-setup.html';
    link.textContent='Configurar Google Drive';
    link.dataset.driveSetupLink='true';
    link.className='tc-back';
    $('galleryState').appendChild(link);
   }
  }
  $('refreshBtn').disabled=false; $('refreshBtn').textContent='Atualizar dados';
 }
 document.addEventListener('click',async event=>{
  const photo=event.target.closest('[data-photo-url]');
  if(photo){openPhoto(photo.dataset.photoUrl,photo.dataset.photoCaption,photo.dataset.photoName);return;}
  const button=event.target.closest('[data-import-album]');
  if(!button) return;
  const album=button.dataset.importAlbum;
  button.disabled=true; button.textContent='Importando…';
  try {
   const result=await api('finalize',{method:'POST',body:JSON.stringify({album})});
   if(result.total_imported>0) alert('Produto criado com '+result.imported[0].images+' foto(s).');
   else if(result.skipped?.length) alert('Não foi possível importar: '+result.skipped.map(x=>x.reason).join(', '));
   await refresh();
  } catch(e) {
   alert('Falha ao importar o álbum: '+e.message);
   button.disabled=false; button.textContent='Importar como produto';
  }
 });
 $('refreshBtn').addEventListener('click',refresh);
 refresh();
})();