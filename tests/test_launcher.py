import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'companion'))
import launcher

class LauncherTests(unittest.TestCase):
    def test_launcher_prepares_extension_private_connection_file(self):
        writer=getattr(launcher,'write_local_link',None)
        self.assertTrue(callable(writer),'Automatic local linking is not implemented')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'extension').mkdir()
            writer(root,'a'*48)
            data=json.loads((root/'extension/local-link.json').read_text(encoding='utf-8'))
            self.assertEqual(data['app'],'rewards-realtime-adviser');self.assertEqual(data['token'],'a'*48)
            self.assertNotIn('email',data)

if __name__=='__main__':unittest.main()
