"""Start/stop helper for Windows; no browser credentials are read."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
from server import APP, PORT, Store, device_directory

ROOT=Path(__file__).resolve().parents[1]

def write_local_link(root,token):
    target=Path(root)/'extension/local-link.json'
    temporary=target.with_suffix('.tmp')
    temporary.write_text(json.dumps({'app':APP,'token':token}),encoding='utf-8')
    temporary.replace(target)

def request(route,token,body=None):
    req=urllib.request.Request(f'http://127.0.0.1:{PORT}'+route,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=2) as response:return json.load(response)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','stop','status'],default='start',nargs='?');args=parser.parse_args()
    store=Store(ROOT/'.state',device_dir=device_directory())
    if args.action=='stop':
        try:request('/api/shutdown',store.token,{})
        except (OSError,urllib.error.URLError):print('Servizio già fermo.');return
        print('Collegamento locale fermato.');return
    if args.action=='status':
        try:request('/api/state',store.token);print('Collegamento locale attivo.');return
        except (OSError,urllib.error.URLError):print('Collegamento locale fermo.');sys.exit(1)
    write_local_link(ROOT,store.token)
    pairing=ROOT/'ABBINAMENTO-LOCALE.txt'
    pairing.write_text('REWARDS ADVISER\n\nChiave locale personale:\n\n'+store.token+'\n\nQuesta chiave resta sul tuo PC. Non condividerla.\n\n1. Carica la cartella principale che contiene manifest.json in ciascun profilo del browser.\n2. Scegli Lettore 1, 2 o 3 per i tuoi account oppure Pannello.\n3. Salva e collega, quindi apri Rewards in ogni lettore.\n4. Lascia un solo coordinatore dei promemoria attivo.\n\nGuida: README.html\n',encoding='utf-8')
    try:request('/api/state',store.token)
    except urllib.error.HTTPError:
        raise RuntimeError('La porta locale è occupata da un servizio con un\'altra chiave. Ferma la copia precedente prima di avviare questa.')
    except (OSError,urllib.error.URLError):
        executable=Path(sys.executable).with_name('pythonw.exe')
        if not executable.exists():executable=Path(sys.executable)
        flags=(subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS) if sys.platform=='win32' else 0
        subprocess.Popen([str(executable),str(ROOT/'companion/server.py')],cwd=str(ROOT),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
        for _ in range(30):
            time.sleep(.15)
            try:request('/api/state',store.token);break
            except (OSError,urllib.error.URLError):continue
        else:raise RuntimeError('Impossibile avviare il collegamento locale sulla porta '+str(PORT))
    print('Collegamento locale attivo e configurazione automatica pronta. Guida: README.html')

if __name__=='__main__':
    try:main()
    except Exception as error:print('Errore:',error);sys.exit(1)
