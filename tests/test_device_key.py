import json,sys,tempfile,unittest,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'companion'))
try:from connection import local_token
except ImportError:local_token=None

class DeviceKeyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def key(self,state,device):
        self.assertTrue(callable(local_token),'Device-local key storage missing')
        return local_token(self.root/state,self.root/device)
    def test_one_pc_key_survives_restart_and_another_project_folder(self):
        first=self.key('copy1','pc1');self.assertRegex(first,r'^[a-f0-9]{48}$')
        self.assertEqual(first,self.key('copy1','pc1'));self.assertEqual(first,self.key('copy2','pc1'))
        self.assertNotEqual(first,self.key('copy3','pc2'))
    def test_existing_installation_migrates_without_breaking_browser_pairing(self):
        state=self.root/'old';state.mkdir();(state/'config.json').write_text(json.dumps({'token':'a'*48,'port':18743}))
        self.assertEqual(self.key('old','pc1'),'a'*48);self.assertEqual(self.key('new','pc1'),'a'*48)
    def test_invalid_device_key_is_not_silently_replaced(self):
        device=self.root/'pc1';device.mkdir();(device/'connection.json').write_text('{"token":"broken"}')
        self.assertTrue(callable(local_token))
        with self.assertRaises(ValueError):local_token(self.root/'state',device)

    def test_simultaneous_first_start_waits_for_the_other_writer_to_finish(self):
        self.assertTrue(callable(local_token))
        device=self.root/'pc1';device.mkdir();path=device/'connection.json';path.write_text('')
        def finish_first_start():
            time.sleep(.08);path.write_text(json.dumps({'token':'b'*48,'port':18743}))
        thread=threading.Thread(target=finish_first_start);thread.start()
        try:self.assertEqual(local_token(self.root/'second',device),'b'*48)
        finally:thread.join()

    def test_concurrent_launchers_share_one_key_without_colliding_cache_files(self):
        self.assertTrue(callable(local_token))
        with ThreadPoolExecutor(max_workers=8) as pool:
            values=list(pool.map(lambda _:local_token(self.root/'same-state',self.root/'same-pc'),range(24)))
        self.assertEqual(len(set(values)),1)
        self.assertEqual(json.loads((self.root/'same-state/config.json').read_text())['token'],values[0])

if __name__=='__main__':unittest.main()
