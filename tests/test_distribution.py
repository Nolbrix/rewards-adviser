"""Public package boundary tests. All private artifacts below are synthetic."""
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_FILES = (
    'manifest.json', '_locales/en/messages.json', '_locales/it/messages.json',
    'extension/strings.js', 'extension/i18n.js', 'extension/_locales/en/messages.json', 'extension/_locales/it/messages.json',
    'companion/connection.py', 'extension/background.js', 'extension/content.js',
    'extension/core.js', 'extension/parser.js', 'extension/reader.js', 'extension/search.js', 'extension/profiles.js',
    'extension/ui/index.html', 'extension/ui/ui.js', 'extension/ui/ui.css',
    'extension/ui/demo.js', 'extension/public-identity.json', 'extension/account.js', 'extension/auth-config.json', 'extension/auth-offscreen.html', 'extension/auth-offscreen.js', 'extension/ui/account-ui.js', 'extension/icons/rewards-adviser.svg', 'extension/icons/icon16.png',
    'extension/icons/icon32.png', 'extension/icons/icon48.png',
    'extension/icons/icon128.png', 'companion/server.py', 'companion/launcher.py',
    'companion/phone_native.py', 'companion/phone_vision.py',
    'companion/phone_ocr.ps1', 'companion/phone_reader.py',
)

try:
    spec = importlib.util.spec_from_file_location('public_distribution', ROOT / 'companion/distribution.py')
    distribution = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(distribution)
except (FileNotFoundError, ImportError):
    distribution = None


def load_python(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PublicPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = self.folder / 'personal-copy'
        for name in RUNTIME_FILES:
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.destination = self.folder / 'Rewards-Adviser-Condivisibile.zip'

    def build(self):
        builder = getattr(distribution, 'build_public_package', None)
        self.assertTrue(callable(builder), 'Public package builder is not implemented')
        result = builder(self.source, self.destination)
        self.assertEqual(result, self.destination)
        return zipfile.ZipFile(self.destination)

    def extract(self):
        with self.build() as archive:
            archive.extractall(self.folder / 'friend')
        return self.folder / 'friend'

    def node(self, code, folder):
        executable = os.environ.get('REWARDS_TEST_NODE') or shutil.which('node')
        if not executable:
            bundled = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
            if bundled.is_file():
                executable = str(bundled)
        self.assertTrue(executable, 'Node is required to exercise the public extension modules')
        result = subprocess.run([executable, '-e', code], cwd=folder, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_archive_has_only_runtime_assets_and_generated_setup_files(self):
        # Catches a broad recursive archive that accidentally shares private files.
        fake_secret = 'private-fixture-secret-' + 'c' * 48
        excluded = (
            '.state/config.json', '.state/state.json', 'extension/local-link.json',
            'extension/local-link.tmp', 'ABBINAMENTO-LOCALE.txt', 'account-page.html',
            'work/nested/rewards.html', 'tests/test_secret.py', 'docs/private.txt',
            'companion/__pycache__/server.pyc', 'Rewards-Realtime-Adviser.zip',
            '.state/phone-reader/calibration.json', '.state/phone-reader/profile-one.bmp',
            '.state/phone-reader/counter-probe.bmp', '.state/phone-reader/nested/raw-screen.bmp',
        )
        for name in excluded:
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(fake_secret, encoding='utf-8')
        with self.build() as archive:
            self.assertEqual(set(archive.namelist()), set(RUNTIME_FILES) | {'START.cmd', 'STOP.cmd', 'README.html'})
            self.assertTrue(all(not name.startswith('/') and '..' not in PurePosixPath(name).parts for name in archive.namelist()))
            self.assertTrue(all(fake_secret.encode() not in archive.read(name) for name in archive.namelist()))

    def test_root_manifest_and_panel_references_resolve_inside_archive(self):
        # Catches an extension ZIP with the wrong root layout or missing script/icon.
        with self.build() as archive:
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['manifest_version'], 3)
            references = [manifest['background']['service_worker'], manifest['action']['default_popup']]
            references += list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values())
            for content in manifest['content_scripts']:
                references.extend(content['js'])
            for name in references:
                self.assertIn(name, archive.namelist())
            popup = manifest['action']['default_popup']
            html = archive.read(popup).decode('utf-8')
            for reference in re.findall(r'(?:src|href)="([^"]+)"', html):
                if reference.startswith(('https://', 'http://', '#')):
                    continue
                target = str(PurePosixPath(popup).parent / reference)
                normalized = os.path.normpath(target).replace('\\', '/')
                self.assertIn(normalized, archive.namelist())

    def test_public_package_contains_no_personal_identity_or_absolute_user_path(self):
        # Catches personal defaults copied into any otherwise allowed runtime file.
        private = ('PersonalFixture', 'PrivateFixture', 'PrivateUser', 'private@example.net',
                   'another@example.net', 'third@example.net')
        with self.build() as archive:
            for name in archive.namelist():
                if name.endswith(('.png', '.jpg', '.jpeg')):
                    continue
                content = archive.read(name).decode('utf-8').casefold()
                for identity in private:
                    self.assertNotIn(identity.casefold(), content, name)
                self.assertNotRegex(content, r'[a-z]:[\\/]users[\\/]')

    def test_public_presets_assign_free_reader_slots_without_overwriting_connection_or_browser(self):
        # Catches retaining a personal preset or forcibly choosing somebody else's browser.
        friend = self.extract()
        data = self.node("""
const profiles=require('./extension/profiles.js');
const current={token:'private-current-token',clientId:'existing-client',browser:'Brave',slot:3,email:'old@example.test',coordinator:true};
const readers=[1,2,3].map(slot=>profiles.apply('reader'+slot,current));
const panel=profiles.apply('panel',current);
console.log(JSON.stringify({keys:Object.keys(profiles.presets),readers,panel,custom:profiles.apply('custom',current),matched:readers.map(c=>profiles.keyFor(c)),unconfigured:profiles.keyFor({slot:null,email:'',alias:'Account',coordinator:false})}));
""", friend)
        self.assertEqual(data['keys'], ['reader1', 'reader2', 'reader3', 'panel'])
        for slot, reader in enumerate(data['readers'], 1):
            self.assertEqual(reader['slot'], slot)
            self.assertEqual(reader['alias'], f'Account {slot}')
            self.assertEqual(reader['email'], '')
            self.assertEqual(reader['browser'], 'Brave')
            self.assertEqual(reader['token'], 'private-current-token')
            self.assertEqual(reader['clientId'], 'existing-client')
            self.assertFalse(reader['coordinator'])
            self.assertTrue(reader['autoRefresh'])
        self.assertIsNone(data['panel']['slot'])
        self.assertEqual(data['panel']['email'], '')
        self.assertEqual(data['panel']['browser'], 'Brave')
        self.assertEqual(data['panel']['token'], 'private-current-token')
        self.assertTrue(data['panel']['coordinator'])
        self.assertFalse(data['panel']['autoRefresh'])
        self.assertEqual(data['matched'], ['reader1', 'reader2', 'reader3'])
        self.assertEqual(data['unconfigured'], '')
        self.assertEqual(data['custom']['email'], 'old@example.test')

    def test_public_core_and_demo_start_with_generic_names(self):
        # Catches personal account names in the public empty state or demo view.
        data = self.node("""
globalThis.RewardsCore=require('./extension/core.js');require('./extension/ui/demo.js');
console.log(JSON.stringify({defaults:[1,2,3,null].map(RewardsCore.defaultAlias),demo:RewardsDemo.view().state.accounts.map(a=>a.alias)}));
""", self.extract())
        self.assertEqual(data['defaults'], ['Account 1', 'Account 2', 'Account 3', 'Pannello'])
        self.assertEqual(data['demo'], ['Account 1', 'Account 2', 'Account 3'])

    def test_each_recipient_generates_its_own_key_and_discovers_page_email(self):
        # Catches shipping a shared key, a personal default name, or requiring a configured email.
        friend = self.extract()
        server = load_python('public_server', friend / 'companion/server.py')
        first = server.Store(self.folder / 'first-private-state')
        second = server.Store(self.folder / 'second-private-state')
        self.assertRegex(first.token, r'^[a-f0-9]{48}$')
        self.assertNotEqual(first.token, second.token)
        self.assertEqual([a['alias'] for a in first.view()['accounts']], ['Account 1', 'Account 2', 'Account 3'])
        first.apply('/api/heartbeat', {'clientId': 'friend-reader', 'config': {'slot': 1, 'alias': 'Account 1', 'email': '', 'browser': 'Edge', 'coordinator': True}})
        result = first.apply('/api/snapshot', {'clientId': 'friend-reader', 'snapshot': {
            'date': server.day_key(), 'observedAt': int(time.time() * 1000),
            'account': {'email': 'friend@example.test'}, 'balance': 10,
            'activities': [], 'coverage': {'daily': True, 'extra': True, 'search': False, 'mobile': False},
            'diagnostics': {'recognized': True, 'method': 'structured'},
        }})
        self.assertTrue(result['accepted'])
        self.assertEqual(first.view()['accounts'][0]['email'], 'friend@example.test')
        self.assertEqual(first.view()['coordinatorId'], 'friend-reader')

    def test_public_phone_reader_ships_code_but_starts_off_without_private_calibration(self):
        friend = self.extract()
        server = load_python('public_phone_server', friend / 'companion/server.py')
        store = server.Store(self.folder / 'private-phone-state')
        self.assertFalse(store.view()['phoneReader']['enabled'])
        self.assertEqual(store.view()['phoneReader']['status'], 'off')
        self.assertTrue(all(a['phoneReading'] is None for a in store.view()['accounts']))
        state = store.apply('/api/phone/settings', {'enabled': True})['state']
        self.assertEqual(state['phoneReader']['status'], 'calibration-needed')
        for name in ('phone_native.py', 'phone_vision.py', 'phone_ocr.ps1', 'phone_reader.py'):
            self.assertTrue((friend / 'companion' / name).is_file(), name)
        self.assertFalse((friend / '.state/phone-reader').exists())
        guide = (friend / 'README.html').read_text(encoding='utf-8').casefold()
        for required in ('conferma manuale', '0 a 30', 'banner', 'mythic'):
            self.assertIn(required, guide)
        self.assertNotIn('non trasferisce automaticamente il contatore', guide)

    def test_build_does_not_change_personal_runtime_files(self):
        # Catches sanitization accidentally written into the user's live installation.
        before = {name: (self.source / name).read_bytes() for name in RUNTIME_FILES}
        with self.build():
            pass
        self.assertEqual(before, {name: (self.source / name).read_bytes() for name in RUNTIME_FILES})

    @unittest.skipUnless(os.name == 'nt', 'Windows batch launch contract')
    def test_portable_commands_run_relative_launcher_in_a_folder_with_spaces(self):
        # Catches quoting, working-directory or argument errors in the portable CMDs.
        # The fixture replaces the service-starting boundary to leave real services alone.
        friend = self.extract()
        spaced = self.folder / 'My Rewards Folder'
        friend.rename(spaced)
        (spaced / 'companion/launcher.py').write_text(
            "import json,sys\nfrom pathlib import Path\n"
            "Path('launcher-call.json').write_text(json.dumps({'action':sys.argv[1],"
            "'cwd':str(Path.cwd()),'root':str(Path(__file__).resolve().parents[1]),"
            "'version':list(sys.version_info[:2])}))\n", encoding='utf-8')
        environment = {**os.environ, 'PATH': str(Path(sys.executable).parent)}
        for command, action in (('START.cmd', 'start'), ('STOP.cmd', 'stop')):
            result = subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c', str(spaced / command)],
                                    cwd=self.folder, env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            call = json.loads((spaced / 'launcher-call.json').read_text())
            self.assertEqual(call['action'], action)
            self.assertTrue(Path(call['cwd']).samefile(spaced))
            self.assertTrue(Path(call['root']).samefile(spaced))
            self.assertGreaterEqual(tuple(call['version']), (3, 11))

    def test_missing_runtime_asset_does_not_create_incomplete_package(self):
        # Catches silently distributing an extension that cannot load its parser.
        (self.source / 'extension/parser.js').unlink()
        builder = getattr(distribution, 'build_public_package', None)
        self.assertTrue(callable(builder), 'Public package builder is not implemented')
        with self.assertRaises(FileNotFoundError):
            builder(self.source, self.destination)
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
