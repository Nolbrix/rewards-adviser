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
        except (OSError,urllib.error.URLError):print('Local service is already stopped.');return
        print('Local connection stopped.');return
    if args.action=='status':
        try:request('/api/state',store.token);print('Local connection is running.');return
        except (OSError,urllib.error.URLError):print('Local connection is stopped.');sys.exit(1)
    write_local_link(ROOT,store.token)
    pairing=ROOT/'ABBINAMENTO-LOCALE.txt'
    pairing.write_text('REWARDS ADVISER\n\nPrivate local connection key:\n\n'+store.token+'\n\nThis key stays on your PC. Keep it private.\n\n1. Load the root folder containing manifest.json in each browser profile.\n2. Choose Reader 1, 2 or 3 for your accounts, or Dashboard.\n3. Save and connect, then open Rewards in every reader.\n4. Keep only one reminder coordinator enabled.\n\nGuide: README.html\n',encoding='utf-8')
    try:request('/api/state',store.token)
    except urllib.error.HTTPError:
        raise RuntimeError('The local port is used by a service with a different key. Stop the previous copy before starting this one.')
    except (OSError,urllib.error.URLError):
        executable=Path(sys.executable).with_name('pythonw.exe')
        if not executable.exists():executable=Path(sys.executable)
        flags=(subprocess.CREATE_NO_WINDOW|subprocess.DETACHED_PROCESS) if sys.platform=='win32' else 0
        subprocess.Popen([str(executable),str(ROOT/'companion/server.py')],cwd=str(ROOT),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
        for _ in range(30):
            time.sleep(.15)
            try:request('/api/state',store.token);break
            except (OSError,urllib.error.URLError):continue
        else:raise RuntimeError('Unable to start the local connection on port '+str(PORT))
    print('Local connection is running and automatic setup is ready. Guide: README.html')

if __name__=='__main__':
    try:main()
    except Exception as error:print('Error:',error);sys.exit(1)
