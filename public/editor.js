/* RTA rich editor: only allowlisted HTML reaches display or submission. */
function safeRichURL(value, image=false) {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return false;
  if (image && /^\/media\/[a-f0-9]{32}$/.test(value)) return true;
  try { const u=new URL(value); return u.protocol==='https:' && !!u.hostname && !u.username; } catch { return false; }
}
function safeRichHTML(value) {
  const parsed=new DOMParser().parseFromString(String(value||''),'text/html');
  const allowed=new Set(['P','BR','DIV','SPAN','STRONG','B','EM','I','U','S','STRIKE','UL','OL','LI','BLOCKQUOTE','H2','H3','A','IMG']);
  function clean(node) {
    if(node.nodeType===3)return document.createTextNode(node.textContent);
    if(node.nodeType!==1)return document.createDocumentFragment();
    if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','FORM','INPUT'].includes(node.tagName))return document.createDocumentFragment();
    const out=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):document.createDocumentFragment();
    if(out.nodeType===1) {
      if(node.tagName==='A' && safeRichURL(node.getAttribute('href'))) {out.href=node.getAttribute('href');out.target='_blank';out.rel='noopener noreferrer';}
      if(node.tagName==='IMG') {
        if(!safeRichURL(node.getAttribute('src'),true))return document.createDocumentFragment();
        out.src=node.getAttribute('src');out.alt=(node.getAttribute('alt')||'Image jointe').slice(0,300);out.loading='lazy';out.referrerPolicy='no-referrer';
      }
      if(['P','DIV','SPAN','H2','H3'].includes(node.tagName)) {
        for(const prop of ['color','background-color','text-align'])if(node.style.getPropertyValue(prop))out.style.setProperty(prop,node.style.getPropertyValue(prop));
      }
    }
    for(const child of node.childNodes)out.append(clean(child));
    return out;
  }
  const container=document.createElement('div');for(const child of parsed.body.childNodes)container.append(clean(child));return container.innerHTML;
}
function richBody(row) {
  return row.rich_html ? `<div class="rich-body">${safeRichHTML(row.rich_html)}</div>` : `<div class="rich-body legacy-text">${esc(row.text)}</div>`;
}
async function richRequest(path,method,data) {
  const response=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||''},body:data?JSON.stringify(data):undefined});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Opération impossible');return result;
}
function installRichEditor(form,scope) {
  const textarea=form.querySelector('textarea');const shell=document.createElement('div');shell.className='rich-shell';
  shell.innerHTML=`<div class="rich-toolbar" role="toolbar" aria-label="Mise en forme"><select aria-label="Style de paragraphe"><option value="p">Paragraphe</option><option value="h2">Grand titre</option><option value="h3">Sous-titre</option><option value="blockquote">Citation</option></select><button type="button" data-command="bold" title="Gras (Ctrl+B)"><b>G</b></button><button type="button" data-command="italic" title="Italique (Ctrl+I)"><i>I</i></button><button type="button" data-command="underline" title="Souligner"><u>S</u></button><button type="button" data-command="strikeThrough" title="Barrer"><s>B</s></button><button type="button" data-command="insertUnorderedList" title="Liste à puces">• Liste</button><button type="button" data-command="insertOrderedList" title="Liste numérotée">1. Liste</button><button type="button" data-command="justifyLeft" title="Aligner à gauche">Gauche</button><button type="button" data-command="justifyCenter" title="Centrer">Centrer</button><button type="button" data-command="justifyRight" title="Aligner à droite">Droite</button><label class="color-picker" title="Couleur du texte">Couleur <input type="color" value="#192b3d" aria-label="Couleur du texte"></label><button type="button" data-tool="link">Lien</button><button type="button" data-tool="image">Image par lien</button><button type="button" data-tool="upload">Image du PC</button><button type="button" data-tool="remove-image">Retirer l’image</button><button type="button" data-command="undo" title="Annuler">↶</button><button type="button" data-command="redo" title="Rétablir">↷</button><button type="button" data-command="removeFormat">Effacer le style</button></div><div class="rich-editor" contenteditable="true" role="textbox" aria-label="Contenu de la publication" aria-multiline="true" data-placeholder="Écrivez votre publication…"></div><div class="rich-status" role="status">0 / 10 000 caractères · Images : JPEG, PNG, WebP, GIF · 5 Mo maximum</div><input type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif">`;
  textarea.replaceWith(shell);const area=shell.querySelector('.rich-editor'),status=shell.querySelector('.rich-status'),file=shell.querySelector('[type=file]');let range=null,selectedImage=null,pending=false;
  function remember(){const s=window.getSelection();if(s.rangeCount&&area.contains(s.anchorNode))range=s.getRangeAt(0).cloneRange();}
  function restore(){area.focus();if(range&&area.contains(range.commonAncestorContainer)){const s=window.getSelection();s.removeAllRanges();s.addRange(range);}}
  function count(){status.textContent=`${area.innerText.trim().length} / 10 000 caractères · ${pending?'Import en cours…':'Images : 5 Mo maximum'}`;}
  function command(name,value=null){restore();document.execCommand(name,false,value);remember();count();}
  function image(url){command('insertHTML',`<p><img src="${esc(url)}" alt="Image jointe"></p><p><br></p>`);}
  shell.querySelectorAll('button').forEach(b=>b.addEventListener('mousedown',e=>e.preventDefault()));
  shell.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.command)return command(b.dataset.command);
    if(b.dataset.tool==='link'){const url=prompt('Adresse HTTPS du lien :','https://');if(url===null)return;if(!safeRichURL(url))return toast('Utilisez une adresse complète commençant par https://');restore();const selection=window.getSelection();if(selection.isCollapsed)command('insertHTML',`<a href="${esc(url)}">${esc(url)}</a>`);else command('createLink',url);}
    if(b.dataset.tool==='image'){const url=prompt('Lien direct HTTPS de l’image (pas le lien de la page) :','https://');if(url===null)return;if(!safeRichURL(url,true))return toast('Adresse HTTPS de l’image invalide');image(url);}
    if(b.dataset.tool==='upload')file.click();
    if(b.dataset.tool==='remove-image'){if(selectedImage&&area.contains(selectedImage)){selectedImage.remove();selectedImage=null;count();}else toast('Cliquez d’abord sur l’image à retirer.');}
  });
  shell.querySelector('select').onchange=e=>command('formatBlock',e.target.value);
  shell.querySelector('[type=color]').oninput=e=>{restore();document.execCommand('styleWithCSS',false,true);command('foreColor',e.target.value);};
  for(const event of ['keyup','mouseup','input','blur'])area.addEventListener(event,remember);
  area.addEventListener('input',count);
  area.addEventListener('click',e=>{area.querySelectorAll('.selected-image').forEach(n=>n.classList.remove('selected-image'));selectedImage=e.target.tagName==='IMG'?e.target:null;if(selectedImage)selectedImage.classList.add('selected-image');});
  area.addEventListener('paste',e=>{e.preventDefault();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');command('insertHTML',html?safeRichHTML(html):esc(text).replace(/\n/g,'<br>'));});
  area.addEventListener('drop',e=>e.preventDefault());
  file.onchange=async()=>{const chosen=file.files[0];if(!chosen)return;
    if(pending)return;if(chosen.size>5*1024*1024){file.value='';return toast('Image trop volumineuse : maximum 5 Mo.');}
    pending=true;count();try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Lecture du fichier impossible'));reader.readAsDataURL(chosen);});
      const result=await richRequest('uploads','POST',{data,scope});image(result.url);toast('Image ajoutée. Publiez pour enregistrer le contenu.');
    }catch(error){toast(error.message);}finally{pending=false;file.value='';count();}
  };
  return {element:area,set(row){area.innerHTML=row.rich_html?safeRichHTML(row.rich_html):esc(row.text||'').replace(/\n/g,'<br>');range=null;count();},payload(){if(pending)throw Error('Attendez la fin de l’import de l’image.');const text=area.innerText.trim();if(text.length>10000)throw Error('Maximum : 10 000 caractères.');const html=safeRichHTML(area.innerHTML);if(!text&&!html.includes('<img '))throw Error('Ajoutez du texte ou une image.');return {text,rich_html:html};}};
}
function renderPublications(panel,rows,kind,label){
  const editable=['reports','messages'].includes(kind)||is('director');
  panel.innerHTML=`<h3>${esc(label)}</h3>${editable?'<form class="publication-form"><div class="field-label">Contenu</div><textarea name="text"></textarea><div class="publication-actions"><button type="submit">Publier</button><button type="button" class="secondary cancel-edit" hidden>Annuler la modification</button></div></form>':''}<div class="publications">${rows.slice().reverse().map(r=>`<article class="card publication" data-publication="${esc(r.id)}">${richBody(r)}<small class="muted">${esc(r.author)} · ${esc(r.date)}${r.updated_at?' · Modifié le '+esc(r.updated_at):''}</small>${r.can_edit?`<div class="publication-actions"><button type="button" class="secondary" data-edit="${esc(r.id)}">Modifier</button><button type="button" class="danger" data-delete="${esc(r.id)}">Supprimer</button></div>`:''}</article>`).join('')||'<p class="muted">Aucune publication pour le moment.</p>'}</div>`;
  let editor,editing=null;const form=panel.querySelector('form');
  if(form){editor=installRichEditor(form,kind);const submit=form.querySelector('[type=submit]'),cancel=form.querySelector('.cancel-edit');cancel.onclick=()=>{if(!confirm('Abandonner les modifications en cours ?'))return;editing=null;editor.set({text:''});submit.textContent='Publier';cancel.hidden=true;};
    form.onsubmit=async e=>{e.preventDefault();try{const data=editor.payload();submit.disabled=true;if(editing)await richRequest(kind+'/'+editing.id,'PATCH',{...data,revision:editing.revision||0});else await api(kind,data);toast(editing?'Publication modifiée':'Publication enregistrée');await personnel();}catch(error){toast(error.message);}finally{submit.disabled=false;}};
  }
  panel.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editing=rows.find(r=>r.id===b.dataset.edit);if(!editor)return;editor.set(editing);form.querySelector('[type=submit]').textContent='Enregistrer les modifications';form.querySelector('.cancel-edit').hidden=false;form.scrollIntoView({behavior:'smooth',block:'start'});editor.element.focus();});
  panel.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Supprimer définitivement cette publication ?'))return;b.disabled=true;try{await richRequest(kind+'/'+b.dataset.delete,'DELETE');toast('Publication supprimée');await personnel();}catch(error){toast(error.message);b.disabled=false;}});
}
