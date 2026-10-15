"""Export curated, generic GitHub source. Never copy a running installation."""
import argparse
import json
import importlib.util
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

EXTRA_FILES=(
    'docs/auth/index.html','docs/auth/bridge.js','docs/auth/config.js','firestore.rules','firebase.json','docs/AUTH-SETUP.md','tests/account.test.js','tests/account.integration.js','README.md','.gitignore','package.json','.github/workflows/tests.yml',
    'companion/distribution.py','extension/manifest.json','extension/translations.json',
    'tools/build_locales.py','tools/export_public.py',
    'tests/background.test.js','tests/core.test.js',
    'tests/i18n.test.js','tests/i18n-render.test.js','tests/modern-page.test.js',
    'tests/parser.test.js','tests/phone-auto.test.js','tests/phone-ui.test.js',
    'tests/public-profiles.test.js','tests/search.test.js','tests/browser.integration.js',
    'tests/public.integration.js','tests/serve_fixture.py',
    'tests/fixtures/bing-home.html','tests/fixtures/rewards-next-dashboard.html',
    'tests/test_device_key.py','tests/test_distribution.py','tests/test_launcher.py',
    'tests/test_phone.py','tests/test_phone_native.py','tests/test_phone_observations.py',
    'tests/test_phone_ocr.py','tests/test_phone_reader.py','tests/test_phone_vision.py',
    'tests/test_server.py','tests/test_source_export.py',
)

def export_source(root,destination):
    root=Path(root).resolve();destination=Path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('La destinazione dei sorgenti pubblici deve essere vuota.')
    spec=importlib.util.spec_from_file_location('public_distribution',root/'companion/distribution.py')
    distribution=importlib.util.module_from_spec(spec);spec.loader.exec_module(distribution)
    for name in EXTRA_FILES:
        if not (root/name).is_file():raise FileNotFoundError(name)
    with tempfile.TemporaryDirectory(prefix='rewards-source-') as temporary:
        staging=Path(temporary)/'source';staging.mkdir()
        archive=distribution.build_public_package(root,Path(temporary)/'public.zip')
        with zipfile.ZipFile(archive) as zipped:zipped.extractall(staging)
        for name in EXTRA_FILES:
            target=staging/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,target)
        manifest=json.loads((staging/'extension/manifest.json').read_text(encoding='utf-8'));manifest['key']=json.loads((staging/'extension/public-identity.json').read_text(encoding='utf-8'))['key'];(staging/'extension/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        for path in staging.rglob('*'):
            if not path.is_file() or path.suffix.lower() in ('.png','.jpg','.jpeg'):continue
            source=path.read_text(encoding='utf-8')
            if re.search(r'[A-Za-z]:[\\/]Users[\\/]',source):raise ValueError('Percorso personale nei sorgenti: '+path.relative_to(staging).as_posix())
            addresses=re.findall(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',source)
            if any(not a.lower().endswith(('@example.com','@example.net','@example.test')) for a in addresses):
                raise ValueError('Email non di esempio nei sorgenti: '+path.relative_to(staging).as_posix())
        destination.parent.mkdir(parents=True,exist_ok=True)
        if destination.exists():
            # copytree requires a new directory; only remove an empty destination.
            destination.rmdir()
        shutil.copytree(staging,destination)
    return destination

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path);args=parser.parse_args()
    result=export_source(Path(__file__).resolve().parents[1],args.destination)
    print('Public source ready: '+str(result))
