"""Rewards Adviser loopback relay. Python standard library only."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit
try:
    from .connection import local_token, device_directory
except ImportError:
    try:from connection import local_token, device_directory
    except ImportError:from companion.connection import local_token, device_directory

APP = 'rewards-realtime-adviser'
PORT = 18743
DEFAULT_NAMES = ('Account 1', 'Account 2', 'Account 3')
CATEGORIES = {'daily', 'extra', 'search', 'desktop', 'mobile', 'phone'}
SEARCH_STATUSES = ('ok', 'not-signed-in', 'account-mismatch', 'unavailable', 'identity-unverified')
PHONE_STATUSES = ('off', 'calibration-needed', 'waiting-phone', 'waiting-idle', 'reading', 'ready', 'interrupted', 'unreadable', 'account-unavailable', 'error')
PHONE_REASONS = frozenset(('target-unavailable','target-invalid','target-ambiguous','desktop-locked','desktop-busy','input-interrupted','target-changed','target-covered','target-not-foreground','lease-expired','lease-invalid','lease-busy','invalid-coordinate','invalid-key','invalid-scroll','invalid-idle','invalid-timeout','input-failed','capture-failed','platform-unavailable','input-watch-unavailable','input-unavailable','calibration-needed','interrupted','unreadable','account-unavailable','rewards-loading-timeout'))
ORIGIN = re.compile(r'^chrome-extension://[a-p]{32}$')

def day_key(zone='Europe/Rome', stamp=None):
    now = datetime.now(timezone.utc) if stamp is None else datetime.fromtimestamp(stamp / 1000, timezone.utc)
    if zone == 'UTC': return now.date().isoformat()
    # Europe/Rome, including DST, without requiring a tzdata installation on Windows.
    def last_sunday(month):
        following = datetime(now.year, month + 1, 1, tzinfo=timezone.utc)
        last = following - timedelta(days=1)
        return last - timedelta(days=(last.weekday() + 1) % 7)
    summer = last_sunday(3).replace(hour=1) <= now < last_sunday(10).replace(hour=1)
    return (now + timedelta(hours=2 if summer else 1)).date().isoformat()

def text(value, limit=240):
    if not isinstance(value, str): raise ValueError('Testo non valido')
    return value.strip()[:limit]

def points(value):
    if value is None: return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100000000:
        raise ValueError('Contatore punti non valido')
    return value

def email(value):
    value = text(value or '', 254).lower()
    if value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value): raise ValueError('Email non valida')
    return value or None

def safe_url(value):
    if not isinstance(value, str) or len(value) > 2048: return None
    u = urlsplit(value)
    return value if u.scheme == 'https' and not u.username and (u.hostname == 'bing.com' or (u.hostname or '').endswith('.bing.com') or u.hostname == 'rewards.microsoft.com') else None

def activity(raw, manual=False, today=None):
    if not isinstance(raw, dict): raise ValueError('Attività non valida')
    activity_id = text(raw.get('id', ''),160)
    if not activity_id: raise ValueError('Identificatore attività mancante')
    category = 'phone' if manual else raw.get('category')
    status = raw.get('status', 'unknown')
    if category not in CATEGORIES or status not in {'unknown', 'incomplete', 'complete', 'not-applicable'}: raise ValueError('Stato attività non valido')
    manual_read = manual and activity_id == 'manual-read'
    total = 30 if manual_read else points(raw.get('total'))
    earned = (total if status == 'complete' else 0 if status == 'incomplete' else None) if manual else points(raw.get('earned'))
    confirmed = raw.get('confirmedPoints')
    if manual and confirmed is not None:
        if not manual_read: raise ValueError('Punti confermati disponibili solo per le letture articoli Bing')
        if isinstance(confirmed, bool) or not isinstance(confirmed, int) or not 0 <= confirmed <= 30: raise ValueError('Conferma da 0 a 30 punti interi per le letture articoli Bing')
        earned = confirmed
        status = 'complete' if confirmed == 30 else 'incomplete'
    if total is not None and earned is not None and earned > total: raise ValueError('Progressi superiori al massimo')
    result = {'id':activity_id, 'title':text(raw.get('title', 'Attività')), 'category':category, 'status':status, 'total':total, 'earned':earned, 'source':'manual' if manual else 'page'}
    if manual: result['date'] = today
    else: result['url'] = safe_url(raw.get('url'))
    return result

class Conflict(Exception): pass

class Store:
    def __init__(self, directory, device_dir=None):
        self.directory = Path(directory); self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock(); self.config_path = self.directory / 'config.json'
        self.token = local_token(self.directory, device_dir)
        self.path = self.directory / 'state.json'
        self.state = {'version':1,'revision':0,'accounts':[self.blank(i) for i in range(1,4)],'clients':{},'coordinatorId':None,'settings':{'timezone':'Europe/Rome','notifications':True,'snoozeUntil':0}}
        if self.path.exists(): self.state = json.loads(self.path.read_text(encoding='utf-8'))
        self.state['phoneReader'] = {'enabled':False,'status':'off','updatedAt':0,'lastCycleAt':None,'slot':None,**self.state.get('phoneReader',{})}
        for account in self.state['accounts']:
            account.setdefault('phoneReading',None)
            account.setdefault('phoneError',None)
            account.pop('phoneReaderEnabled',None) # Derived by view(), never persisted.
            if not account['clientId'] and account['alias'] == f"Account {account['slot']}":
                account['alias'] = DEFAULT_NAMES[account['slot']-1]
        self.commands = {}
    @staticmethod
    def blank(slot): return {'slot':slot,'alias':DEFAULT_NAMES[slot-1],'browser':'','clientId':None,'email':None,'snapshot':None,'manual':[],'phoneReading':None,'phoneError':None,'error':None,'lastSeen':None}
    def save(self):
        self.state['revision'] += 1
        temp = self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state,ensure_ascii=False),encoding='utf-8'); temp.replace(self.path)
    def view(self):
        with self.lock:
            result = deepcopy(self.state); result['now'] = int(time.time()*1000)
            for a in result['accounts']:
                client = result['clients'].get(a['clientId'],{})
                a['lastSeen'] = client.get('lastSeen')
                a['phoneReaderEnabled'] = result['phoneReader']['enabled'] is True
            return result
    def client(self, client_id):
        client_id=text(client_id,100)
        if not re.fullmatch(r'[A-Za-z0-9_-]{6,100}',client_id): raise ValueError('Profilo non valido')
        return client_id
    def slot(self, value):
        if isinstance(value,bool) or value not in (1,2,3): raise ValueError('Account non valido')
        return self.state['accounts'][value-1]
    def apply(self, route, body):
        with self.lock:
            result = self._apply(route,body); self.save(); return result
    def _apply(self, route, b):
        now=int(time.time()*1000)
        if route == '/api/heartbeat':
            cid=self.client(b.get('clientId','')); c=b.get('config')
            if not isinstance(c,dict): raise ValueError('Configurazione mancante')
            slot=c.get('slot'); slot=None if slot is None else self.slot(slot)['slot']
            label=text(c.get('alias','Account'),80); browser=text(c.get('browser','Browser'),40); configured_email=email(c.get('email',''))
            coordinator=c.get('coordinator') is True
            current=self.state['coordinatorId']
            if coordinator and current and current != cid and now-self.state['clients'].get(current,{}).get('lastSeen',0)<300000:
                raise Conflict('Un altro profilo è già coordinatore. Disattivalo prima nelle impostazioni.')
            if slot:
                a=self.slot(slot)
                if a['clientId'] and a['clientId']!=cid: raise Conflict('Questo account è già associato a un altro profilo. Scegli uno slot libero.')
                if a['email'] and configured_email and a['email']!=configured_email: raise Conflict('Email diversa: usa Nuova associazione prima di cambiare account.')
            # Release previous slot when this reader is reconfigured.
            for index,old in enumerate(self.state['accounts']):
                if old['clientId']==cid and old['slot']!=slot: self.state['accounts'][index]=self.blank(old['slot'])
            self.state['clients'][cid]={'slot':slot,'alias':label,'browser':browser,'lastSeen':now,'coordinator':coordinator}
            if coordinator:self.state['coordinatorId']=cid
            elif current==cid:self.state['coordinatorId']=None
            if slot:
                a=self.slot(slot);a.update(clientId=cid,alias=label,browser=browser)
                if configured_email and not a['email']:a['email']=configured_email
            self.commands[cid]=[cmd for cmd in self.commands.get(cid,[]) if now-cmd['createdAt']<120000]
            return {'state':self.view(),'commands':deepcopy(self.commands[cid])}
        if route == '/api/snapshot':
            cid=self.client(b.get('clientId','')); c=self.state['clients'].get(cid)
            if not c or not c['slot']: raise ValueError('Associa questo profilo a un account nelle impostazioni')
            a=self.slot(c['slot'])
            if a['clientId']!=cid:raise Conflict('Associazione del profilo cambiata')
            if 'slot' in b and self.slot(b['slot'])['slot']!=c['slot']:raise Conflict('La lettura appartiene alla configurazione precedente')
            if b.get('expectedEmail') and email(b['expectedEmail'])!=a['email']:raise Conflict('La lettura appartiene alla configurazione precedente')
            if a['error']=='account-change':raise Conflict('Cambio account rilevato: usa Nuova associazione per confermare l’identità.')
            raw=b.get('snapshot')
            if not isinstance(raw,dict):raise ValueError('Lettura non valida')
            raw_account=raw.get('account',{})
            if not isinstance(raw_account,dict):raise ValueError('Identità non valida')
            observed_email=email(raw_account.get('email',''))
            if not observed_email and a.get('snapshot',{} ) and (a['snapshot'].get('account',{}).get('identityVerified') or a['error']=='identity-unverified'):
                a['error']='identity-unverified';return {'accepted':False,'state':self.view()}
            if a['email'] and observed_email and a['email']!=observed_email:
                a['error']='account-change';self.save();raise Conflict('La pagina Microsoft mostra un altro account. Usa Nuova associazione per confermare il cambio.')
            diagnostic=raw.get('diagnostics',{})
            if not isinstance(diagnostic,dict):raise ValueError('Diagnosi non valida')
            if diagnostic.get('recognized') is not True:
                a['error']='page-unrecognized';return {'accepted':False,'state':self.view()}
            date=text(raw.get('date',''),10)
            datetime.strptime(date,'%Y-%m-%d')
            stamp=raw.get('observedAt')
            if isinstance(stamp,bool) or not isinstance(stamp,(int,float)) or not now-129600000<=stamp<=now+30000:raise ValueError('Data della lettura non valida')
            activities=raw.get('activities',[])
            if not isinstance(activities,list) or len(activities)>500:raise ValueError('Elenco attività non valido')
            coverage=raw.get('coverage',{})
            if not isinstance(coverage,dict):raise ValueError('Copertura non valida')
            search_mode=raw.get('searchMode')
            if search_mode is not None and search_mode not in ('combined','separate'):raise ValueError('Modalità ricerche non valida')
            normalized={'date':date,'observedAt':stamp,'account':{'email':observed_email,'identityVerified':bool(observed_email)},'balance':points(raw.get('balance')),'activities':[activity(x) for x in activities],'coverage':{k:coverage.get(k) is True for k in ('daily','extra','search','mobile')},'diagnostics':{'recognized':True,'method':text(diagnostic.get('method','page'),40)}}
            if search_mode is not None:normalized['searchMode']=search_mode
            if diagnostic.get('searchStatus') in SEARCH_STATUSES:normalized['diagnostics']['searchStatus']=diagnostic['searchStatus']
            if observed_email:a['email']=observed_email
            a['snapshot']=normalized;a['error']=None
            return {'accepted':True,'state':self.view()}
        if route == '/api/command':
            target=b.get('target');action_name=b.get('action')
            if action_name not in ('refresh','open','scan'):raise ValueError('Comando non consentito')
            if target!='all':self.slot(target)
            targets=[a['clientId'] for a in self.state['accounts'] if a['clientId'] and (target=='all' or a['slot']==target)]
            for cid in targets:
                q=[x for x in self.commands.get(cid,[]) if now-x['createdAt']<120000]
                if not any(x['action']==action_name for x in q):q.append({'id':secrets.token_hex(8),'action':action_name,'createdAt':now})
                self.commands[cid]=q[-10:]
            return {'targeted':len(targets)}
        if route == '/api/ack':
            cid=self.client(b.get('clientId','')); command=text(b.get('commandId',''),64)
            self.commands[cid]=[c for c in self.commands.get(cid,[]) if c['id']!=command];return {'ok':True}
        if route == '/api/manual':
            a=self.slot(b.get('slot'));raw=b.get('activities')
            if not isinstance(raw,list) or len(raw)>30:raise ValueError('Massimo 30 attività manuali')
            normalized=[activity(x,True,day_key(self.state['settings']['timezone'])) for x in raw]
            previous={x['id']:x for x in a['manual']}
            for supplied,item in zip(raw,normalized):
                if 'confirmNow' in supplied and (not isinstance(supplied['confirmNow'],bool) or item['id']!='manual-read'):raise ValueError('Conferma manuale articoli non valida')
                if item['id']!='manual-read':continue
                old=previous.get(item['id'],{})
                if supplied.get('confirmNow') is True:item['confirmedAt']=now
                elif all(old.get(k)==item.get(k) for k in ('date','earned','status','total')) and old.get('confirmedAt') is not None:item['confirmedAt']=old['confirmedAt']
            a['manual']=normalized;return {'state':self.view()}
        if route == '/api/phone/settings':
            if set(b) != {'enabled'} or not isinstance(b['enabled'],bool):raise ValueError('Preferenza lettura telefono non valida')
            reader=self.state['phoneReader'];enabled=b['enabled']
            if reader['enabled']!=enabled:
                reader.update(enabled=enabled,status='calibration-needed' if enabled else 'off',updatedAt=now,slot=None)
            return {'state':self.view()}
        if route == '/api/phone/status':
            status=b.get('status');slot=b.get('slot')
            if status not in PHONE_STATUSES:raise ValueError('Stato lettore telefono non valido')
            reason=b.get('reason')
            if reason is not None and (not isinstance(reason,str) or reason not in PHONE_REASONS):raise ValueError('Diagnostica telefono non valida')
            if slot is not None and (type(slot) is not int or slot not in (1,2,3)):raise ValueError('Account telefono non valido')
            cycle=b.get('lastCycleAt')
            if cycle is not None and (isinstance(cycle,bool) or not isinstance(cycle,(int,float)) or not 0<=cycle<=now+2000 or not math.isfinite(cycle)):raise ValueError('Data lettore telefono non valida')
            reader=self.state['phoneReader']
            reader.update(status=status if reader['enabled'] else 'off',slot=slot if reader['enabled'] else None,updatedAt=now)
            reader['reason']=reason if reader['enabled'] else None
            failed=status in ('calibration-needed','waiting-phone','interrupted','unreadable','account-unavailable','error')
            if reader['enabled'] and failed:
                affected=[self.slot(slot)] if slot is not None else self.state['accounts']
                for account in affected:account['phoneError']={'status':status,'at':now}
            if 'lastCycleAt' in b:reader['lastCycleAt']=cycle
            return {'state':self.view()}
        if route == '/api/phone/observation':
            if not self.state['phoneReader']['enabled']:raise Conflict('La lettura automatica del telefono è in pausa')
            slot=b.get('slot')
            if type(slot) is not int or slot not in (1,2,3):raise ValueError('Account telefono non valido')
            a=self.slot(slot)
            expected=email(b.get('expectedEmail'));before=email(b.get('beforeEmail'));after=email(b.get('afterEmail'))
            if not expected or not a['email'] or expected!=a['email'] or before!=expected or after!=expected:raise Conflict('L’identità della lettura telefono non corrisponde all’account associato')
            date=b.get('date');stamp=b.get('observedAt')
            if date!=day_key('Europe/Rome'):raise ValueError('La lettura telefono non appartiene alla giornata corrente')
            if isinstance(stamp,bool) or not isinstance(stamp,(int,float)) or not now-120000<=stamp<=now+2000 or not math.isfinite(stamp):raise ValueError('Data della lettura telefono non valida')
            if day_key('Europe/Rome',stamp)!=date:raise ValueError('La lettura telefono attraversa il cambio giornata')
            earned=b.get('earned');total=b.get('total')
            if type(earned) is not int or not 0<=earned<=30 or type(total) is not int or total!=30:raise ValueError('Contatore articoli telefono non valido')
            normalized={'date':date,'observedAt':stamp,'earned':earned,'total':30,'status':'complete' if earned==30 else 'incomplete','source':'phone-screen'}
            previous=a.get('phoneReading')
            if previous and (stamp<previous['observedAt'] or stamp==previous['observedAt'] and previous!=normalized):raise Conflict('Una lettura telefono più recente è già disponibile')
            a['phoneReading']=normalized
            a['phoneError']=None
            return {'accepted':True,'state':self.view()}
        if route == '/api/settings':
            settings=self.state['settings']
            if 'timezone' in b:
                if b['timezone'] != 'Europe/Rome':raise ValueError('Questa versione usa la giornata italiana Europe/Rome in tutti i lettori')
                settings['timezone']=b['timezone']
            if 'notifications' in b:
                if not isinstance(b['notifications'],bool):raise ValueError('Preferenza notifiche non valida')
                settings['notifications']=b['notifications']
            if 'snoozeUntil' in b:
                value=b['snoozeUntil']
                if isinstance(value,bool) or not isinstance(value,(int,float)) or not 0<=value<=now+172800000:raise ValueError('Pausa non valida')
                settings['snoozeUntil']=value
            return {'state':self.view()}
        if route == '/api/reset':
            a=self.slot(b.get('slot'));cid=self.client(b.get('clientId',''))
            if a['clientId']!=cid:raise Conflict('Puoi riassociare solo il profilo corrente')
            self.state['accounts'][a['slot']-1]=self.blank(a['slot']);return {'ok':True}
        raise ValueError('Operazione non disponibile')

def make_server(host='127.0.0.1',port=PORT,state_dir=None,extension_dir=None):
    if host != '127.0.0.1':raise ValueError('Il servizio è disponibile soltanto sul PC locale')
    root=Path(__file__).resolve().parents[1]
    store=Store(state_dir or root/'.state',device_dir=device_directory() if state_dir is None else None);extension=Path(extension_dir or root/'extension')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def valid_host(self):return self.headers.get('Host')==f'127.0.0.1:{self.server.server_port}'
        def respond(self,status,payload=None,content=None,mime='application/json'):
            data=content if content is not None else json.dumps(payload,ensure_ascii=False).encode('utf-8')
            self.send_response(status);self.send_header('Content-Type',mime+'; charset=utf-8');self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            origin=self.headers.get('Origin','')
            if ORIGIN.fullmatch(origin):self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
            self.end_headers();self.wfile.write(data)
        def allowed(self):
            if not self.valid_host():self.respond(403,{'error':'Host locale richiesto'});return False
            origin=self.headers.get('Origin','')
            if origin and not ORIGIN.fullmatch(origin):self.respond(403,{'error':'Origine non autorizzata'});return False
            authorization=self.headers.get('Authorization','')
            if not secrets.compare_digest(authorization,'Bearer '+store.token):self.respond(401,{'error':'Chiave di collegamento errata o mancante'});return False
            return True
        def do_OPTIONS(self):
            origin=self.headers.get('Origin','')
            if not self.valid_host() or not ORIGIN.fullmatch(origin):self.respond(403,{'error':'Origine non autorizzata'});return
            self.send_response(204);self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Access-Control-Allow-Methods','GET, POST');self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type');self.send_header('Access-Control-Allow-Private-Network','true');self.send_header('Content-Length','0');self.end_headers()
        def do_GET(self):
            if not self.valid_host():self.respond(403,{'error':'Host locale richiesto'});return
            if self.path=='/health':self.respond(200,{'app':APP,'version':1});return
            if self.path=='/profiles.js':
                file=extension/'profiles.js'
                if not file.is_file():self.respond(404,{'error':'Anteprima non disponibile'});return
                source=re.sub(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','account@example.com',file.read_text(encoding='utf-8'))
                self.respond(200,content=source.encode('utf-8'),mime='text/javascript');return
            public={'/account.js':'account.js','/profiles.js':'profiles.js','/preview/account-ui.js':'ui/account-ui.js','/icons/icon48.png':'icons/icon48.png','/preview/':'ui/index.html','/preview/index.html':'ui/index.html','/preview/ui.css':'ui/ui.css','/preview/ui.js':'ui/ui.js','/preview/demo.js':'ui/demo.js','/core.js':'core.js','/strings.js':'strings.js','/i18n.js':'i18n.js'}
            if self.path in public:
                file=extension/public[self.path]
                if not file.is_file():self.respond(404,{'error':'Anteprima non disponibile'});return
                mime='image/jpeg' if file.suffix=='.jpg' else 'image/png' if file.suffix=='.png' else 'text/css' if file.suffix=='.css' else 'text/javascript' if file.suffix=='.js' else 'text/html'
                self.respond(200,content=file.read_bytes(),mime=mime);return
            if not self.allowed():return
            if self.path=='/api/state':self.respond(200,store.view())
            else:self.respond(404,{'error':'Percorso non disponibile'})
        def do_POST(self):
            if not self.allowed():return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=524288:raise ValueError('Richiesta troppo grande o vuota')
                if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Formato JSON richiesto')
                self.connection.settimeout(5)
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError('Oggetto JSON richiesto')
                if self.path=='/api/shutdown':
                    self.respond(200,{'ok':True});threading.Thread(target=self.server.shutdown,daemon=True).start();return
                self.respond(200,store.apply(self.path,body))
            except Conflict as e:self.respond(409,{'error':str(e)})
            except (ValueError,TypeError,KeyError,AttributeError) as e:self.respond(400,{'error':str(e) or 'Richiesta non valida'})
            except (TimeoutError,OSError):self.respond(408,{'error':'Richiesta incompleta'})
    http=ThreadingHTTPServer((host,port),Handler);http.store=store;http.daemon_threads=True
    return http

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=PORT);args=parser.parse_args()
    server=make_server(port=args.port)
    from phone_reader import PhoneReader
    reader=PhoneReader(server.store,Path(__file__).resolve().parents[1]/'.state/phone-reader/calibration.json')
    reader.start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        reader.stop()
        server.server_close()
