import importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
try:
    spec=importlib.util.spec_from_file_location('source_export',ROOT/'tools/export_public.py')
    export=importlib.util.module_from_spec(spec);spec.loader.exec_module(export)
except FileNotFoundError:export=None

class PublicSourceTests(unittest.TestCase):
    def test_github_source_is_runnable_and_contains_only_curated_source_files(self):
        self.assertTrue(callable(getattr(export,'export_source',None)),'Public GitHub source export missing')
        with tempfile.TemporaryDirectory() as tmp:
            destination=Path(tmp)/'public';export.export_source(ROOT,destination)
            names={p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
            for name in ('manifest.json','README.md','.gitignore','extension/profiles.js','companion/connection.py','tools/build_locales.py','extension/translations.json','tests/test_device_key.py'):
                self.assertIn(name,names)
            self.assertTrue(all(not n.startswith(('.state/','work/','docs/superpowers/')) for n in names))
            self.assertFalse(any(n.endswith(('.bmp','.zip')) or 'local-link' in n or 'ABBINAMENTO' in n for n in names))
            self.assertEqual(json.loads((destination/'manifest.json').read_text())['default_locale'],'en')
            for name in names:
                if name.endswith('.png'):continue
                self.assertNotRegex((destination/name).read_text(encoding='utf-8'),r'[A-Za-z]:[\\/]Users[\\/]')
    def test_export_refuses_a_dirty_destination_instead_of_publishing_unknown_files(self):
        self.assertTrue(callable(getattr(export,'export_source',None)))
        with tempfile.TemporaryDirectory() as tmp:
            destination=Path(tmp)/'public';destination.mkdir();(destination/'personal.txt').write_text('private')
            with self.assertRaises(ValueError):export.export_source(ROOT,destination)

if __name__=='__main__':unittest.main()
