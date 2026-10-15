import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error

try:
    spec = importlib.util.spec_from_file_location('adviser_server', Path(__file__).parents[1] / 'companion/server.py')
    server_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server_module)
except (FileNotFoundError, ImportError):
    server_module = None

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(server_module, 'Local service not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.server = server_module.make_server('127.0.0.1', 0, Path(self.temp.name), Path(__file__).parents[1] / 'extension')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
        self.token = self.server.store.token
    def tearDown(self):
        if hasattr(self, 'server'):
            self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()
    def request(self, route, body=None, token=None, origin='chrome-extension://'+'a'*32):
        headers={'Authorization':'Bearer '+(token if token is not None else self.token), 'Origin':origin}
        if body is not None: headers['Content-Type']='application/json'
        req=urllib.request.Request(self.base+route, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=3) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)
    def register(self, slot=1, client='reader-one', **config):
        return self.request('/api/heartbeat', {'clientId':client,'config':{'slot':slot,'alias':'Account '+str(slot),'browser':'Chrome','email':'','coordinator':False,**config}})
    def snapshot(self, email='alice@example.com', **changes):
        return {'date':server_module.day_key(),'observedAt':int(time.time()*1000),'account':{'email':email},'balance':12345,'activities':[{'id':'quiz','title':'Quiz','category':'daily','total':20,'earned':0,'status':'incomplete','source':'page'}],'coverage':{'daily':True,'extra':False,'search':False,'mobile':False},'diagnostics':{'recognized':True,'method':'structured'},**changes}
    def test_wrong_token_and_web_origin_cannot_read_private_data(self):
        self.assertEqual(self.request('/api/state',token='wrong')[0],401)
        self.assertEqual(self.request('/api/state',origin='https://evil.example')[0],403)
    def test_profiles_keep_accounts_separate(self):
        self.register(); self.register(2,'reader-two')
        self.assertEqual(self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})[0],200)
        self.request('/api/snapshot',{'clientId':'reader-two','snapshot':self.snapshot('bob@example.com',balance=88)})
        accounts=self.request('/api/state')[1]['accounts']
        self.assertEqual(accounts[0]['snapshot']['balance'],12345); self.assertEqual(accounts[1]['snapshot']['balance'],88)
    def test_account_change_is_blocked_without_explicit_reset(self):
        self.register();self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})
        self.assertEqual(self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot('bob@example.com')})[0],409)
        self.assertEqual(self.request('/api/state')[1]['accounts'][0]['snapshot']['account']['email'],'alice@example.com')
    def test_unrecognized_page_preserves_previous_snapshot(self):
        self.register();self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})
        self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(activities=[],balance=None,diagnostics={'recognized':False,'method':'unrecognized'})})
        account=self.request('/api/state')[1]['accounts'][0]
        self.assertEqual(account['snapshot']['balance'],12345);self.assertEqual(account['error'],'page-unrecognized')
    def test_delayed_snapshot_cannot_replace_newer_points(self):
        self.register()
        stamp=int(time.time()*1000)
        self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(observedAt=stamp,balance=200)})
        status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(observedAt=stamp-20000,balance=100)})
        self.assertEqual(status,200);self.assertFalse(response['accepted'])
        self.assertEqual(response['state']['accounts'][0]['snapshot']['balance'],200)
    def test_delayed_page_errors_cannot_disable_a_newer_valid_reading(self):
        self.register()
        stamp=int(time.time()*1000)
        self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(observedAt=stamp,balance=200)})
        for stale in (self.snapshot(observedAt=stamp-20000,diagnostics={'recognized':False}),self.snapshot(email=None,observedAt=stamp-20000),self.snapshot(email='old@example.com',observedAt=stamp-20000)):
            with self.subTest(stale=stale['diagnostics']):
                status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':stale})
                self.assertEqual(status,200);self.assertFalse(response['accepted'])
                self.assertIsNone(response['state']['accounts'][0]['error'])
                self.assertEqual(response['state']['accounts'][0]['snapshot']['balance'],200)
    def test_claimable_credit_remains_distinct_from_earning_tasks(self):
        self.register()
        claim={'id':'pointsclaim','title':'Claimable credit','category':'claim','total':1162,'earned':0,'status':'incomplete'}
        status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(activities=[claim])})
        self.assertEqual(status,200)
        self.assertEqual(response['state']['accounts'][0]['snapshot']['activities'][0]['category'],'claim')
    def test_commands_are_delivered_once_after_ack(self):
        self.register();self.request('/api/command',{'target':1,'action':'refresh'})
        commands=self.register()[1]['commands'];self.assertEqual(commands[0]['action'],'refresh')
        self.request('/api/ack',{'clientId':'reader-one','commandId':commands[0]['id']})
        self.assertEqual(self.register()[1]['commands'],[])
    def test_manual_phone_progress_has_today_date_and_zero_earned(self):
        status,_=self.request('/api/manual',{'slot':1,'activities':[{'id':'checkin','title':'Check-in','total':10,'status':'incomplete'}]})
        self.assertEqual(status,200)
        a=self.request('/api/state')[1]['accounts'][0]['manual'][0]
        self.assertEqual(a['date'],server_module.day_key());self.assertEqual(a['earned'],0);self.assertEqual(a['source'],'manual')
    def test_invalid_activity_is_rejected_instead_of_converted_to_zero(self):
        self.register();s=self.snapshot();s['activities'][0]['total']=-20
        self.assertEqual(self.request('/api/snapshot',{'clientId':'reader-one','snapshot':s})[0],400)
    def test_coordinator_is_unique_and_second_reader_cannot_claim_slot(self):
        self.assertEqual(self.register(None,'edge-one',coordinator=True,browser='Edge')[0],200)
        self.assertEqual(self.register(None,'edge-two',coordinator=True,browser='Edge')[0],409)
        self.register();self.assertEqual(self.register(1,'other-reader')[0],409)
    def test_snapshot_persists_without_secret_fields(self):
        self.register();s=self.snapshot();s['token']='private';s['activities'][0]['cookie']='session'
        self.request('/api/snapshot',{'clientId':'reader-one','snapshot':s})
        restored=server_module.Store(Path(self.temp.name))
        self.assertEqual(restored.state['accounts'][0]['snapshot']['balance'],12345)
        self.assertNotIn('private',json.dumps(restored.state));self.assertNotIn('cookie',json.dumps(restored.state))
    def test_anonymous_snapshot_cannot_bypass_an_identity_conflict(self):
        self.register();self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})
        self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot('bob@example.com',balance=200)})
        status,_=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(None,balance=200)})
        self.assertEqual(status,409)
        account=self.request('/api/state')[1]['accounts'][0]
        self.assertEqual(account['error'],'account-change');self.assertEqual(account['snapshot']['balance'],12345)
    def test_missing_identity_preserves_previously_verified_capture(self):
        self.register();self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})
        result=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(None,balance=200)})[1]
        self.assertFalse(result['accepted']);self.assertEqual(self.request('/api/state')[1]['accounts'][0]['error'],'identity-unverified')
        self.assertEqual(self.request('/api/state')[1]['accounts'][0]['snapshot']['balance'],12345)
    def test_moving_reader_clears_old_counters_and_manual_tasks(self):
        self.register();self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot()})
        self.request('/api/manual',{'slot':1,'activities':[{'id':'checkin','title':'Check-in','total':10,'status':'incomplete'}]})
        self.register(2,'reader-one')
        account=self.request('/api/state')[1]['accounts'][0]
        self.assertIsNone(account['snapshot']);self.assertEqual(account['manual'],[]);self.assertIsNone(account['email'])
    def test_delayed_capture_cannot_follow_reader_into_another_slot(self):
        self.register();self.register(2,'reader-one')
        status,_=self.request('/api/snapshot',{'clientId':'reader-one','slot':1,'expectedEmail':'alice@example.com','snapshot':self.snapshot()})
        self.assertEqual(status,409)
        account=self.request('/api/state')[1]['accounts'][1]
        self.assertIsNone(account['snapshot']);self.assertIsNone(account['email']);self.assertIsNone(account['error'])
    def test_delayed_capture_cannot_lock_new_email_after_reset(self):
        self.register(email='alice@example.com')
        self.request('/api/reset',{'slot':1,'clientId':'reader-one'})
        self.register(email='bob@example.com')
        status,_=self.request('/api/snapshot',{'clientId':'reader-one','slot':1,'expectedEmail':'alice@example.com','snapshot':self.snapshot()})
        self.assertEqual(status,409)
        account=self.request('/api/state')[1]['accounts'][0]
        self.assertEqual(account['email'],'bob@example.com');self.assertIsNone(account['error']);self.assertIsNone(account['snapshot'])
    def test_unsupported_timezone_cannot_desynchronize_page_readers(self):
        self.assertEqual(self.request('/api/settings',{'timezone':'UTC'})[0],400)
        self.assertEqual(self.request('/api/state')[1]['settings']['timezone'],'Europe/Rome')
    def test_public_preview_profiles_hide_real_account_emails(self):
        try:
            with urllib.request.urlopen(self.base+'/profiles.js',timeout=3) as response:
                status=response.status;source=response.read().decode('utf-8')
        except urllib.error.HTTPError as response:
            status=response.code;source=response.read().decode('utf-8')
        self.assertEqual(status,200)
        self.assertIn('reader1',source)
        self.assertNotIn('private1@example.net',source)
        self.assertNotIn('private2@example.net',source)
        self.assertNotIn('private3@example.net',source)

    def test_combined_search_category_and_mode_survive_snapshot_normalization(self):
        self.register()
        snapshot=self.snapshot(searchMode='combined',activities=[{'id':'bing-search','title':'Ricerche Bing','category':'search','total':60,'earned':20,'status':'incomplete'}],diagnostics={'recognized':True,'method':'structured','searchStatus':'ok'})
        status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':snapshot})
        self.assertEqual(status,200)
        normalized=response['state']['accounts'][0]['snapshot']
        self.assertEqual(normalized['searchMode'],'combined')
        self.assertEqual(normalized['activities'][0]['category'],'search')
        self.assertEqual(normalized['activities'][0]['earned'],20)
        self.assertEqual(normalized['diagnostics']['searchStatus'],'ok')

    def test_search_mode_accepts_separate_and_rejects_unrecognized_values(self):
        self.register()
        status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(searchMode='separate')})
        self.assertEqual(status,200)
        self.assertEqual(response['state']['accounts'][0]['snapshot'].get('searchMode'),'separate')
        for mode in ['guessed-from-cap',{},False]:
            with self.subTest(mode=mode):
                self.assertEqual(self.request('/api/snapshot',{'clientId':'reader-one','snapshot':self.snapshot(searchMode=mode)})[0],400)

    def test_search_failure_status_preserves_daily_progress_without_account_error(self):
        self.register()
        for search_status in ['not-signed-in','account-mismatch','unavailable','identity-unverified']:
            with self.subTest(search_status=search_status):
                snapshot=self.snapshot(searchMode='combined',diagnostics={'recognized':True,'method':'structured','searchStatus':search_status,'source':'secret-cookie','error':'https://secret.example/?token=secret'})
                status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':snapshot})
                self.assertEqual(status,200)
                account=response['state']['accounts'][0]
                self.assertIsNone(account['error'])
                self.assertEqual(account['snapshot']['activities'][0]['total'],20)
                self.assertEqual(account['snapshot']['diagnostics'].get('searchStatus'),search_status)
                self.assertNotIn('secret',json.dumps(account['snapshot']))

    def test_unrecognized_search_diagnostic_is_not_persisted(self):
        self.register()
        snapshot=self.snapshot(diagnostics={'recognized':True,'method':'structured','searchStatus':'https://secret.example/?token=secret','rawSearch':{'cookie':'secret'}})
        status,response=self.request('/api/snapshot',{'clientId':'reader-one','snapshot':snapshot})
        self.assertEqual(status,200)
        normalized=response['state']['accounts'][0]['snapshot']
        self.assertNotIn('searchStatus',normalized['diagnostics'])
        self.assertNotIn('secret',json.dumps(normalized))

if __name__=='__main__': unittest.main()
