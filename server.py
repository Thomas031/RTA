import http.cookies
import json
import math
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import firebase_admin
from firebase_admin import firestore

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
firebase_admin.initialize_app()
STORE = firestore.client()
BASE_URL = (os.getenv('BASE_URL') or os.getenv('RENDER_EXTERNAL_URL') or 'http://localhost:8000').strip().rstrip('/')
CLIENT_ID = '1563822065965076541'
CLIENT_SECRET = os.getenv('DISCORD_CLIENT_SECRET', '').strip()
REDIRECT_URI = BASE_URL + '/auth/callback'
GUILD = '1243574617545637918'
ROLES = {
    'driver': {'1371513329235001384', '1371513224721338441'},
    'director': {'1243993923597238282', '1243993923219751043', '1243993850586857533'},
    'mechanic': {'1371514119412514867'},
    'controller': {'1371514117239869564'},
}
VEHICLES = [
    {'plate': plate, 'type': kind, 'available': True}
    for plate, kind in [
        ('WZ-860-AP', 'Car'), ('LF-756-WH', 'Car'),
        ('JJ-403-QA', 'Bus'), ('AB-280-LD', 'Bus'),
        ('EH-332-ZH', 'Renault Master dépannage'),
    ]
]
SESSIONS = {}
STATES = {}
LOCK = threading.RLock()
API_COLLECTIONS = {'vehicles', 'services', 'reports', 'messages', 'instructions', 'planning', 'fines', 'traffic', 'fares'}


def records(kind):
    return [doc.to_dict() for doc in STORE.collection(kind).stream()]


def initialize_fleet():
    for vehicle in VEHICLES:
        try:
            STORE.collection('vehicles').document(vehicle['plate']).create(vehicle)
        except Exception as error:
            from google.api_core.exceptions import AlreadyExists
            if not isinstance(error, AlreadyExists):
                raise


def request_json(url, data=None, headers=None):
    request_headers = {
        'User-Agent': 'DiscordBot (https://rta-eg5g.onrender.com, 1.0)',
        'Accept': 'application/json',
    }
    request_headers.update(headers or {})
    request = urllib.request.Request(url, data=data, headers=request_headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def log_error(stage, error):
    # Never log tokens, request bodies, callback URLs, or exception messages.
    print(f'RTA | {stage} | {type(error).__name__} | HTTP {getattr(error, "code", "aucun")}', flush=True)


def clean_expired():
    now = time.time()
    with LOCK:
        for key in list(STATES):
            if STATES[key] < now:
                del STATES[key]
        for key in list(SESSIONS):
            if SESSIONS[key]['expires'] < now:
                del SESSIONS[key]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def send(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def cookies(self):
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except http.cookies.CookieError:
            pass
        return cookie

    def user(self):
        cookie = self.cookies().get('rta_session')
        with LOCK:
            session = SESSIONS.get(cookie.value if cookie else '')
            return session if session and session['expires'] > time.time() else None

    def cookie_value(self, name, value, age):
        secure = '; Secure' if BASE_URL.startswith('https://') else ''
        return f'{name}={value}; HttpOnly; SameSite=Lax; Path=/; Max-Age={age}{secure}'

    def redirect(self, url, cookies=()):
        self.send_response(302)
        self.send_header('Location', url)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        for cookie in cookies:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()

    def do_GET(self):
        try:
            self.handle_get()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            log_error('GET', error)
            self.send({'error': 'Erreur serveur. Consultez les logs Render.'}, 500)

    def handle_get(self):
        path = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(path.query)
        clean_expired()
        if path.path == '/health':
            return self.send({'ok': True})
        if path.path == '/auth/discord':
            if not CLIENT_SECRET:
                return self.redirect('/?auth=configuration')
            state = secrets.token_urlsafe(32)
            with LOCK:
                STATES[state] = time.time() + 600
            params = urllib.parse.urlencode({
                'client_id': CLIENT_ID, 'redirect_uri': REDIRECT_URI,
                'response_type': 'code', 'scope': 'identify guilds.members.read', 'state': state,
            })
            return self.redirect('https://discord.com/oauth2/authorize?' + params,
                                 [self.cookie_value('rta_state', state, 600)])
        if path.path == '/auth/callback':
            return self.discord_callback(query)
        if path.path == '/api/public':
            active = sum(1 for service in records('services') if not service.get('end') and service.get('line') == '1')
            return self.send({'active': active, 'traffic': records('traffic'), 'fares': records('fares')})
        if path.path == '/api/me':
            return self.send(self.user())
        if path.path.startswith('/api/'):
            user = self.user()
            if not user:
                return self.send({'error': 'Connexion requise'}, 401)
            kind = path.path.removeprefix('/api/')
            allowed = {'vehicles', 'services', 'reports', 'messages', 'instructions', 'planning'}
            if set(user['roles']) & {'director', 'controller'}:
                allowed.add('fines')
            if 'director' in user['roles']:
                allowed |= {'traffic', 'fares'}
            if kind not in allowed:
                return self.send({'error': 'Accès refusé'}, 403)
            rows = records(kind)
            if kind == 'services' and 'director' not in user['roles']:
                rows = [row for row in rows if row['user'] == user['id']]
            return self.send(rows)
        return super().do_GET()

    def discord_callback(self, query):
        cookie = self.cookies().get('rta_state')
        state = query.get('state', [''])[0]
        with LOCK:
            expiry = STATES.pop(state, 0)
        if not cookie or not secrets.compare_digest(cookie.value, state) or expiry < time.time():
            return self.send({'error': 'Connexion expirée : recommencez depuis le site RTA.'}, 403)
        if 'error' in query:
            return self.redirect('/?auth=denied')
        code = query.get('code', [''])[0]
        if not code:
            return self.redirect('/?auth=error')
        stage = 'Discord échange du code'
        try:
            payload = urllib.parse.urlencode({
                'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET,
                'grant_type': 'authorization_code', 'code': code, 'redirect_uri': REDIRECT_URI,
            }).encode()
            token = request_json('https://discord.com/api/v10/oauth2/token', payload,
                                 {'Content-Type': 'application/x-www-form-urlencoded'})['access_token']
            headers = {'Authorization': 'Bearer ' + token}
            stage = 'Discord appartenance au serveur'
            member = request_json(f'https://discord.com/api/v10/users/@me/guilds/{GUILD}/member', headers=headers)
            stage = 'Discord identité'
            identity = request_json('https://discord.com/api/v10/users/@me', headers=headers)
            roles = [name for name, ids in ROLES.items() if ids.intersection(member.get('roles', []))]
            if not roles:
                return self.redirect('/?auth=denied')
            sid = secrets.token_urlsafe(40)
            with LOCK:
                SESSIONS[sid] = {
                    'id': identity['id'], 'name': identity.get('global_name') or identity['username'],
                    'roles': roles, 'csrf': secrets.token_urlsafe(32), 'expires': time.time() + 3600,
                }
            return self.redirect('/#personnel', [self.cookie_value('rta_session', sid, 3600),
                                                self.cookie_value('rta_state', '', 0)])
        except Exception as error:
            log_error(stage, error)
            if stage == 'Discord appartenance au serveur' and getattr(error, 'code', None) == 404:
                return self.redirect('/?auth=denied')
            return self.redirect('/?auth=error')

    def do_POST(self):
        user = self.user()
        if not user:
            return self.send({'error': 'Connexion requise'}, 401)
        csrf = self.headers.get('X-CSRF-Token', '')
        if not secrets.compare_digest(csrf, user['csrf']):
            return self.send({'error': 'Requête refusée'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 20000:
                return self.send({'error': 'Taille de requête invalide'}, 413)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Objet JSON attendu')
            path = urllib.parse.urlparse(self.path).path
            if not path.startswith('/api/'):
                return self.send({'error': 'Route inconnue'}, 404)
            kind = path.removeprefix('/api/')
            if kind == 'logout':
                with LOCK:
                    cookie = self.cookies().get('rta_session')
                    if cookie:
                        SESSIONS.pop(cookie.value, None)
                return self.send({'ok': True})
            if kind not in API_COLLECTIONS:
                return self.send({'error': 'Opération inconnue'}, 404)
            # One process serializes writes; distributed deployments require Firestore transactions.
            with LOCK:
                row_id, row = self.prepare_record(kind, data, user)
                STORE.collection(kind).document(row_id).set(row)
            self.send({'ok': True})
            webhook = os.getenv('DISCORD_WEBHOOK_URL', '').strip()
            if kind in {'services', 'reports', 'fines'} and webhook:
                threading.Thread(target=notify, args=(webhook, kind, user['name']), daemon=True).start()
        except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
            self.send({'error': str(error)}, 400)
        except PermissionError as error:
            self.send({'error': str(error)}, 403)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            log_error('POST', error)
            self.send({'error': 'Enregistrement impossible. Consultez les logs Render.'}, 500)

    def prepare_record(self, kind, data, user):
        roles = set(user['roles'])
        director = 'director' in roles
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        row_id = secrets.token_hex(8)
        if kind == 'vehicles':
            if not roles & {'director', 'mechanic'}:
                raise PermissionError('Accès réservé à la mécanique et à la direction')
            row = next((v for v in records(kind) if v['plate'] == data.get('plate')), None)
            if not row:
                raise ValueError('Véhicule inconnu')
            if not isinstance(data.get('available'), bool):
                raise ValueError('État du véhicule invalide')
            row['available'] = data['available']
            row_id = row['plate']
        elif kind == 'services':
            if not roles & {'driver', 'mechanic', 'director'}:
                raise PermissionError('Accès refusé')
            active = [service for service in records(kind) if not service.get('end')]
            if data.get('action') == 'end':
                row = next((service for service in active if service['user'] == user['id']), None)
                if not row:
                    raise ValueError('Aucun service actif')
                row['end'] = now
                row_id = row['id']
            else:
                if any(service['user'] == user['id'] for service in active):
                    raise ValueError('Service déjà actif')
                vehicle = next((v for v in records('vehicles') if v['plate'] == data.get('plate')), None)
                if not vehicle or not vehicle['available']:
                    raise ValueError('Véhicule indisponible')
                master = vehicle['plate'] == 'EH-332-ZH'
                if master and not roles & {'mechanic', 'director'}:
                    raise PermissionError('Master réservé à la mécanique et à la direction')
                if not master and not roles & {'driver', 'director'}:
                    raise PermissionError('Rôle chauffeur requis')
                if any(service['plate'] == vehicle['plate'] for service in active):
                    raise ValueError('Véhicule déjà utilisé')
                row = {'id': row_id, 'user': user['id'], 'name': user['name'], 'plate': vehicle['plate'],
                       'start': now, 'end': None, 'line': 'Dépannage' if master else '1'}
        elif kind == 'fines':
            if not roles & {'controller', 'director'}:
                raise PermissionError('Accès refusé')
            if data.get('action') == 'paid':
                if not director:
                    raise PermissionError('Paiement réservé à la direction')
                row = next((f for f in records(kind) if f['id'] == data.get('id')), None)
                if not row:
                    raise ValueError('Amende inconnue')
                row['paid'] = True
                row_id = row['id']
            else:
                for key in ['name', 'phone', 'reason', 'delivery']:
                    if not isinstance(data.get(key), str) or not data[key].strip():
                        raise ValueError('Tous les champs sont requis')
                amount = float(data.get('amount', 0))
                if not math.isfinite(amount) or amount <= 0:
                    raise ValueError('Montant invalide')
                date.fromisoformat(data['delivery'])
                row = {key: data[key].strip() for key in ['name', 'phone', 'reason', 'delivery']}
                row.update(id=row_id, amount=round(amount, 2), paid=False, author=user['name'])
        else:
            if kind in {'instructions', 'planning', 'traffic', 'fares'} and not director:
                raise PermissionError('Accès direction requis')
            if not isinstance(data.get('text'), str) or not data['text'].strip():
                raise ValueError('Texte requis')
            row = {'id': row_id, 'text': data['text'].strip()[:5000], 'author': user['name'], 'date': now}
        return row_id, row


def notify(webhook, kind, name):
    try:
        separator = '&' if '?' in webhook else '?'
        request_json(webhook + separator + 'wait=true', json.dumps({
            'content': f'RTA : mise à jour {kind} par {name}', 'allowed_mentions': {'parse': []},
        }).encode(), {'Content-Type': 'application/json'})
    except Exception as error:
        log_error('Notification Discord', error)


if __name__ == '__main__':
    initialize_fleet()
    port = int(os.getenv('PORT', '8000'))
    print(f'RTA | Démarrage sur 0.0.0.0:{port} | Retour Discord : {REDIRECT_URI}', flush=True)
    if not CLIENT_SECRET:
        print('RTA | DISCORD_CLIENT_SECRET manquant : connexion désactivée.', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
