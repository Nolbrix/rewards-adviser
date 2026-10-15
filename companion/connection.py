"""Random connection secret for this Windows user on this PC. No hardware IDs."""
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import time

def device_directory():
    base=os.environ.get('LOCALAPPDATA')
    return Path(base)/'RewardsAdviser' if base else Path.home()/'.local/share/RewardsAdviser'

def _read(path):
    data=json.loads(path.read_text(encoding='utf-8'))
    token=data.get('token')
    if not isinstance(token,str) or not re.fullmatch(r'[a-f0-9]{48}',token):
        raise ValueError('Chiave locale non valida. Ripristina il file di collegamento prima di continuare.')
    return token

def _read_stable(path):
    # The exclusive first writer briefly exposes an empty file. All readers use
    # the same bounded wait; corrupt keys are never replaced with a new secret.
    for attempt in range(20):
        try:return _read(path)
        except json.JSONDecodeError:
            if attempt==19:raise ValueError('Collegamento locale incompleto.') from None
            time.sleep(.05)

def _create_once(path, token):
    path.parent.mkdir(parents=True,exist_ok=True)
    try:
        with path.open('x',encoding='utf-8') as stream:
            json.dump({'token':token,'port':18743},stream)
            stream.flush();os.fsync(stream.fileno())
        return token
    except FileExistsError:
        return _read_stable(path)

def local_token(state_directory, device_directory=None):
    state=Path(state_directory);state.mkdir(parents=True,exist_ok=True)
    local=state/'config.json'
    existing=_read_stable(local) if local.exists() else None
    if device_directory is None:
        return existing or _create_once(local,secrets.token_hex(24))
    device=Path(device_directory)/'connection.json'
    token=_read_stable(device) if device.exists() else _create_once(device,existing or secrets.token_hex(24))
    if existing!=token:
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',prefix='connection-',suffix='.tmp',dir=state,delete=False) as stream:
            pending=Path(stream.name);json.dump({'token':token,'port':18743},stream)
            stream.flush();os.fsync(stream.fileno())
        try:
            for attempt in range(20):
                try:pending.replace(local);break
                except PermissionError:
                    if local.exists() and _read_stable(local)==token:break
                    if attempt==19:raise
                    time.sleep(.05)
        finally:pending.unlink(missing_ok=True)
    return token
