import os,json,secrets,time,urllib.request,urllib.parse,http.cookies
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
ROOT=Path(__file__).parent
os.chdir(ROOT)
import firebase_admin
from firebase_admin import firestore
firebase_admin.initialize_app()
STORE=firestore.client()
GUILD='1243574617545637918'
ROLES={'driver':{'1371513329235001384','1371513224721338441'},'director':{'1243993923597238282','1243993923219751043','1243993850586857533'},'mechanic':{'1371514119412514867'},'controller':{'1371514117239869564'}}
VEHICLES=[{'plate':p,'type':t,'available':True} for p,t in [('WZ-860-AP','Car'),('LF-756-WH','Car'),('JJ-403-QA','Bus'),('AB-280-LD','Bus'),('EH-332-ZH','Renault Master dépannage')]]
SESSIONS={};STATES={}
def records(kind):
 return [doc.to_dict() for doc in STORE.collection(kind).stream()]
def initialize_fleet():
 for vehicle in VEHICLES:
  ref=STORE.collection('vehicles').document(vehicle['plate'])
  if not ref.get().exists:ref.set(vehicle)
initialize_fleet()
def request_json(url,data=None,headers=None):
 req=urllib.request.Request(url,data=data,headers=headers or {})
 with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'public'),**kw)
 def log_message(self,*a):pass
 def send(self,data,status=200):
  raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
 def user(self):
  cookie=http.cookies.SimpleCookie(self.headers.get('Cookie',''));sid=cookie.get('rta_session');s=SESSIONS.get(sid.value if sid else '')
  return s if s and s['expires']>time.time() else None
 def redirect(self,url,cookie=None):
  self.send_response(302);self.send_header('Location',url)
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers()
 def do_GET(self):
  path=urllib.parse.urlparse(self.path);q=urllib.parse.parse_qs(path.query)
  if path.path=='/auth/discord':
   if not os.getenv('DISCORD_CLIENT_SECRET'):return self.redirect('/?auth=configuration')
   state=secrets.token_urlsafe(32);STATES[state]=time.time()+600
   params=urllib.parse.urlencode({'client_id':'1563822065965076541','redirect_uri':os.getenv('BASE_URL','http://localhost:8000')+'/auth/callback','response_type':'code','scope':'identify guilds.members.read','state':state})
   return self.redirect('https://discord.com/oauth2/authorize?'+params,'rta_state='+state+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=600'+('; Secure' if os.getenv('BASE_URL','').startswith('https:') else ''))
  if path.path=='/auth/callback':
   cookie=http.cookies.SimpleCookie(self.headers.get('Cookie',''));state=q.get('state',[''])[0]
   if not cookie.get('rta_state') or cookie['rta_state'].value!=state or STATES.pop(state,0)<time.time():return self.send({'error':'Connexion expirée'},403)
   try:
    payload=urllib.parse.urlencode({'client_id':'1563822065965076541','client_secret':os.environ['DISCORD_CLIENT_SECRET'],'grant_type':'authorization_code','code':q.get('code',[''])[0],'redirect_uri':os.getenv('BASE_URL','http://localhost:8000')+'/auth/callback'}).encode()
    token=request_json('https://discord.com/api/v10/oauth2/token',payload,{'Content-Type':'application/x-www-form-urlencoded'})['access_token'];headers={'Authorization':'Bearer '+token}
    member=request_json('https://discord.com/api/v10/users/@me/guilds/'+GUILD+'/member',headers=headers);identity=request_json('https://discord.com/api/v10/users/@me',headers=headers)
    roles=[k for k,v in ROLES.items() if v.intersection(member['roles'])]
    if not roles:return self.redirect('/?auth=denied')
    sid=secrets.token_urlsafe(40);SESSIONS[sid]={'id':identity['id'],'name':identity.get('global_name') or identity['username'],'roles':roles,'csrf':secrets.token_urlsafe(32),'expires':time.time()+3600}
    return self.redirect('/#personnel','rta_session='+sid+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600'+('; Secure' if os.getenv('BASE_URL','').startswith('https:') else ''))
      except Exception as e:
    print(
     "Échec connexion Discord :",
     type(e).__name__,
     "statut HTTP :", getattr(e, "code", "aucun"),
     flush=True
    )
    return self.redirect('/?auth=error')
  if path.path=='/api/public':return self.send({'active':len([s for s in records('services') if not s.get('end') and s.get('line')=='1']),'traffic':records('traffic'),'fares':records('fares')})
  if path.path=='/api/me':return self.send(self.user())
  if path.path.startswith('/api/'):
   u=self.user();kind=path.path.split('/')[-1]
   if not u:return self.send({'error':'Connexion requise'},401)
   allowed={'vehicles','services','reports','messages','instructions','planning'}
   if set(u['roles'])&{'director','controller'}:allowed.add('fines')
   if 'director' in u['roles']:allowed|={'traffic','fares'}
   if kind not in allowed:return self.send({'error':'Accès refusé'},403)
   rows=records(kind)
   if kind=='services' and 'director' not in u['roles']:rows=[r for r in rows if r['user']==u['id']]
   return self.send(rows)
  return super().do_GET()
 def do_POST(self):
  u=self.user()
  if not u:return self.send({'error':'Connexion requise'},401)
  if self.headers.get('X-CSRF-Token')!=u['csrf']:return self.send({'error':'Requête refusée'},403)
  try:
   length=int(self.headers.get('Content-Length','0'))
   if length>20000:return self.send({'error':'Contenu trop long'},413)
   data=json.loads(self.rfile.read(length));kind=self.path.split('/')[-1];director='director' in u['roles'];now=time.strftime('%Y-%m-%d %H:%M:%S')
   if kind=='logout':
    u['expires']=0;return self.send({'ok':True})
   if kind=='vehicles':
    if not director and 'mechanic' not in u['roles']:raise ValueError('Accès réservé à la mécanique et à la direction')
    row=next((v for v in records('vehicles') if v['plate']==data.get('plate')),None)
    if not row:raise ValueError('Véhicule inconnu')
    row['available']=bool(data['available']);id=row['plate']
   elif kind=='services':
    if not set(u['roles'])&{'driver','mechanic','director'}:raise ValueError('Accès refusé')
    active=[s for s in records('services') if not s.get('end')]
    if data.get('action')=='end':
     row=next((s for s in active if s['user']==u['id']),None)
     if not row:raise ValueError('Aucun service actif')
     row['end']=now;id=row['id']
    else:
     if any(s['user']==u['id'] for s in active):raise ValueError('Service déjà actif')
     v=next((v for v in records('vehicles') if v['plate']==data.get('plate')),None)
     if not v or not v['available']:raise ValueError('Véhicule indisponible')
     if v['plate']=='EH-332-ZH' and not set(u['roles'])&{'mechanic','director'}:raise ValueError('Master réservé à la mécanique')
     if v['plate']!='EH-332-ZH' and not set(u['roles'])&{'driver','director'}:raise ValueError('Rôle chauffeur requis')
     if any(s['plate']==v['plate'] for s in active):raise ValueError('Véhicule déjà utilisé')
     id=secrets.token_hex(8);row={'id':id,'user':u['id'],'name':u['name'],'plate':v['plate'],'start':now,'end':None,'line':'Dépannage' if v['plate']=='EH-332-ZH' else '1'}
   elif kind=='fines':
    if not set(u['roles'])&{'controller','director'}:raise ValueError('Accès refusé')
    if data.get('action')=='paid':
     if not director:raise ValueError('Paiement réservé à la direction')
     row=next((f for f in records(kind) if f['id']==data.get('id')),None)
     if not row:raise ValueError('Amende inconnue')
     row['paid']=True;id=row['id']
    else:
     for key in ['name','phone','reason','delivery']:
      if not str(data.get(key,'')).strip():raise ValueError('Tous les champs sont requis')
     if float(data.get('amount',0))<=0:raise ValueError('Montant invalide')
     id=secrets.token_hex(8);row={k:data[k] for k in ['name','phone','reason','delivery','amount']};row.update(id=id,paid=False,author=u['name'])
   elif kind in ['reports','messages','instructions','planning','traffic','fares']:
    if kind in ['instructions','planning','traffic','fares'] and not director:raise ValueError('Accès direction requis')
    if not str(data.get('text','')).strip():raise ValueError('Texte requis')
    id=secrets.token_hex(8);row={'id':id,'text':str(data['text'])[:5000],'author':u['name'],'date':now}
   else:raise ValueError('Opération inconnue')
   STORE.collection(kind).document(id).set(row)
   # Notifications sans données personnelles des voyageurs.
   if kind in ['services','reports','fines'] and os.getenv('DISCORD_WEBHOOK_URL'):
    try:request_json(os.environ['DISCORD_WEBHOOK_URL']+'?wait=true',json.dumps({'content':'RTA : mise à jour '+kind+' par '+u['name'],'allowed_mentions':{'parse':[]}}).encode(),{'Content-Type':'application/json'})
    except Exception:pass
   return self.send({'ok':True})
  except (ValueError,KeyError,TypeError) as e:return self.send({'error':str(e)},400)
if __name__=='__main__':ThreadingHTTPServer(('0.0.0.0',int(os.getenv('PORT','8000'))),Handler).serve_forever()
