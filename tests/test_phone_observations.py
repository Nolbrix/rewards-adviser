import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('phone_observation_server', Path(__file__).parents[1] / 'companion/server.py')
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class PhoneObservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = server_module.Store(Path(self.temp.name))
        self.now = int(time.time() * 1000)
        self.store.apply('/api/heartbeat', {'clientId': 'reader-one', 'config': {'slot': 1, 'email': 'reader@example.com'}})

    def enable(self):
        return self.store.apply('/api/phone/settings', {'enabled': True})

    def test_phone_diagnostics_accept_only_safe_codes_and_clear_after_success(self):
        self.enable()
        self.store.apply('/api/phone/status', {'status':'waiting-phone','reason':'target-covered'})
        self.assertEqual(self.store.view()['phoneReader']['reason'],'target-covered')
        for reason in ('private exception screenshot text', {'image':'private'}, 8):
            with self.assertRaises(ValueError):self.store.apply('/api/phone/status', {'status':'error','reason':reason})
        self.store.apply('/api/phone/status', {'status':'ready','reason':None})
        self.assertIsNone(self.store.view()['phoneReader']['reason'])

    def observation(self, **changes):
        return {'slot': 1, 'expectedEmail': 'reader@example.com', 'beforeEmail': 'reader@example.com', 'afterEmail': 'reader@example.com',
                'date': server_module.day_key('Europe/Rome'), 'observedAt': self.now, 'earned': 12, 'total': 30, **changes}

    def test_defaults_migrate_and_disable_without_fabricating_observations(self):
        state = self.store.view()
        self.assertEqual(state['phoneReader'], {'enabled': False, 'status': 'off', 'updatedAt': 0, 'lastCycleAt': None, 'slot': None})
        self.assertTrue(all(a['phoneReading'] is None for a in state['accounts']))
        state.pop('phoneReader')
        for account in state['accounts']: account.pop('phoneReading')
        self.store.path.write_text(json.dumps(state), encoding='utf-8')
        restored = server_module.Store(Path(self.temp.name))
        self.assertFalse(restored.view()['phoneReader']['enabled'])
        self.assertTrue(all(a['phoneReading'] is None for a in restored.view()['accounts']))

    def test_observation_is_guarded_by_enable_and_preserves_entire_manual_list(self):
        manual = [{'id': 'manual-read', 'title': 'Articoli', 'status': 'incomplete', 'confirmedPoints': 3},
                  {'id': 'manual-checkin', 'title': 'Check-in', 'status': 'complete', 'total': 5}]
        self.store.apply('/api/manual', {'slot': 1, 'activities': manual})
        before = self.store.view()['accounts'][0]['manual']
        with self.assertRaises(server_module.Conflict): self.store.apply('/api/phone/observation', self.observation())
        self.enable()
        response = self.store.apply('/api/phone/observation', self.observation(rawOcr='secret screenshot text', image='private'))
        account = response['state']['accounts'][0]
        self.assertEqual(account['manual'], before)
        self.assertEqual(account['phoneReading'], {'date': self.observation()['date'], 'observedAt': self.now, 'earned': 12, 'total': 30, 'status': 'incomplete', 'source': 'phone-screen'})
        self.assertEqual(account['snapshot'], None)
        self.assertNotIn('secret', self.store.path.read_text(encoding='utf-8'))
        self.assertNotIn('beforeEmail', self.store.path.read_text(encoding='utf-8'))

    def test_full_identity_checks_happen_atomically_before_mutation(self):
        self.enable()
        for changes in ({'beforeEmail': 'other@example.com'}, {'afterEmail': 'other@example.com'}, {'expectedEmail': 'other@example.com'},
                        {'beforeEmail': None}, {'afterEmail': ''}, {'slot': 2}, {'expectedEmail': 'readers@example.com'}):
            before = self.store.view();before.pop('now')
            with self.subTest(changes=changes), self.assertRaises((ValueError, server_module.Conflict)):
                self.store.apply('/api/phone/observation', self.observation(**changes))
            after=self.store.view();after.pop('now');self.assertEqual(after, before)
        self.store.apply('/api/phone/observation', self.observation(beforeEmail='READER@EXAMPLE.COM', afterEmail=' reader@example.com '))

    def test_only_today_and_recent_finite_non_boolean_observations_are_accepted(self):
        self.enable()
        for changes in ({'date': '2000-01-01'}, {'date': None}, {'observedAt': self.now - 121000},
                        {'observedAt': self.now + 4000}, {'observedAt': True}, {'observedAt': float('nan')}, {'observedAt': float('inf')}, {'observedAt': 10**1000}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.store.apply('/api/phone/observation', self.observation(**changes))
            self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])

    def test_observation_cannot_cross_the_italian_midnight(self):
        self.enable()
        with patch.object(server_module, 'day_key', return_value='2026-10-16'):
            with self.assertRaises(ValueError):
                self.store.apply('/api/phone/observation', self.observation(date='2026-10-15'))
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
        def boundary_day(zone='Europe/Rome', stamp=None):
            return '2026-10-16' if stamp is None else '2026-10-15'
        with patch.object(server_module, 'day_key', side_effect=boundary_day):
            with self.assertRaises(ValueError):
                self.store.apply('/api/phone/observation', self.observation(date='2026-10-16'))

    def test_unknown_malformed_and_wrong_denominator_counters_never_become_zero(self):
        self.enable()
        for changes in ({'earned': None}, {'earned': True}, {'earned': '0'}, {'earned': 0.0}, {'earned': -1}, {'earned': 31},
                        {'total': 60}, {'total': '30'}, {'total': 30.0}, {'total': True}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.store.apply('/api/phone/observation', self.observation(**changes))
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
        self.store.apply('/api/phone/observation', self.observation(earned=0))
        self.assertEqual(self.store.view()['accounts'][0]['phoneReading']['earned'], 0)

    def test_older_and_equal_conflicting_observations_preserve_the_newest(self):
        self.enable()
        self.store.apply('/api/phone/observation', self.observation(earned=30))
        original = self.store.view()['accounts'][0]['phoneReading']
        self.assertEqual(original['status'], 'complete')
        self.store.apply('/api/phone/observation', self.observation(earned=30))
        for changes in ({'observedAt': self.now - 1}, {'earned': 20}):
            with self.subTest(changes=changes), self.assertRaises(server_module.Conflict):
                self.store.apply('/api/phone/observation', self.observation(**changes))
            self.assertEqual(self.store.view()['accounts'][0]['phoneReading'], original)

    def test_reset_and_moving_reader_clear_phone_data(self):
        self.enable()
        self.store.apply('/api/phone/observation', self.observation())
        self.store.apply('/api/reset', {'slot': 1, 'clientId': 'reader-one'})
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
        self.store.apply('/api/heartbeat', {'clientId': 'reader-one', 'config': {'slot': 1, 'email': 'reader@example.com'}})
        self.store.apply('/api/phone/observation', self.observation())
        self.store.apply('/api/heartbeat', {'clientId': 'reader-one', 'config': {'slot': 2, 'email': 'reader@example.com'}})
        self.assertIsNone(self.store.view()['accounts'][0]['phoneReading'])
        self.assertIsNone(self.store.view()['accounts'][1]['phoneReading'])

    def test_all_three_slots_store_independent_phone_observations(self):
        self.enable()
        for slot in (1,2,3):
            address='reader@example.com' if slot==1 else f'reader{slot}@example.com'
            if slot!=1:self.store.apply('/api/heartbeat',{'clientId':f'reader-{slot}','config':{'slot':slot,'email':address}})
            self.store.apply('/api/phone/observation',self.observation(slot=slot,expectedEmail=address,beforeEmail=address,afterEmail=address,earned=slot*3))
        self.assertEqual([a['phoneReading']['earned'] for a in self.store.view()['accounts']],[3,6,9])
        self.assertTrue(all(a['snapshot'] is None for a in self.store.view()['accounts']))

    def test_settings_accept_only_boolean_enable_and_status_is_bounded(self):
        for body in ({'enabled': 'yes'}, {'enabled': 1}, {'enabled': True, 'raw': 'private'}, {}):
            with self.subTest(body=body), self.assertRaises(ValueError): self.store.apply('/api/phone/settings', body)
        self.enable()
        for status in ('calibration-needed', 'waiting-phone', 'waiting-idle', 'reading', 'ready', 'interrupted', 'unreadable', 'account-unavailable', 'error'):
            self.store.apply('/api/phone/status', {'status': status, 'slot': 1, 'lastCycleAt': self.now, 'raw': 'private'})
            state = self.store.view()['phoneReader']
            self.assertEqual(state['status'], status)
            self.assertNotIn('raw', state)
        for body in ({'status': 'private exception'}, {'status': 'reading', 'slot': True}, {'status': 'reading', 'slot': 4}, {'status': 'reading', 'lastCycleAt': float('nan')}):
            before = self.store.view()['phoneReader']
            with self.subTest(body=body), self.assertRaises(ValueError): self.store.apply('/api/phone/status', body)
            self.assertEqual(self.store.view()['phoneReader'], before)
        disabled = self.store.apply('/api/phone/settings', {'enabled': False})['state']['phoneReader']
        self.assertFalse(disabled['enabled']); self.assertEqual(disabled['status'], 'off'); self.assertIsNone(disabled['slot'])

    def test_only_explicit_article_confirmation_gets_server_override_time(self):
        raw={'id':'manual-read','title':'Articoli','status':'incomplete','confirmedPoints':12}
        self.store.apply('/api/manual',{'slot':1,'activities':[raw]})
        self.assertNotIn('confirmedAt',self.store.view()['accounts'][0]['manual'][0])
        self.store.apply('/api/manual',{'slot':1,'activities':[{**raw,'confirmNow':True,'confirmedAt':0}]})
        first=self.store.view()['accounts'][0]['manual'][0]['confirmedAt']
        self.assertGreaterEqual(first,self.now)
        self.store.apply('/api/manual',{'slot':1,'activities':[{**raw,'confirmedAt':9999999999999}]})
        self.assertEqual(self.store.view()['accounts'][0]['manual'][0]['confirmedAt'],first)
        self.store.apply('/api/manual',{'slot':1,'activities':[{**raw,'confirmedPoints':15}]})
        self.assertNotIn('confirmedAt',self.store.view()['accounts'][0]['manual'][0])

    def test_reader_enabled_is_derived_for_accounts_without_persisting_duplicate_flags(self):
        self.assertTrue(all(a.get('phoneReaderEnabled') is False for a in self.store.view()['accounts']))
        self.enable()
        self.assertTrue(all(a.get('phoneReaderEnabled') is True for a in self.store.view()['accounts']))
        self.assertTrue(all('phoneReaderEnabled' not in a for a in self.store.state['accounts']))
        self.assertNotIn('phoneReaderEnabled',self.store.path.read_text(encoding='utf-8'))

    def test_failed_account_is_invalidated_without_discarding_other_current_readings(self):
        self.enable()
        self.store.apply('/api/phone/observation',self.observation())
        address='second@example.com'
        self.store.apply('/api/heartbeat',{'clientId':'reader-two','config':{'slot':2,'email':address}})
        second=self.observation(slot=2,expectedEmail=address,beforeEmail=address,afterEmail=address)
        self.store.apply('/api/phone/observation',second)
        self.store.apply('/api/phone/status',{'status':'unreadable','slot':2})
        first,failed=self.store.view()['accounts'][:2]
        self.assertIsNone(first.get('phoneError'))
        self.assertEqual(failed.get('phoneError',{}).get('status'),'unreadable')
        self.assertEqual(failed['phoneReading']['earned'],12,'historical numeric evidence must be retained')
        self.store.apply('/api/phone/status',{'status':'waiting-idle'})
        self.assertEqual(self.store.view()['accounts'][1].get('phoneError'),failed['phoneError'])
        self.store.apply('/api/phone/observation',second)
        self.assertIsNone(self.store.view()['accounts'][1].get('phoneError'))

    def test_global_phone_failure_invalidates_all_accounts_until_individual_success(self):
        self.enable()
        self.store.apply('/api/phone/observation',self.observation())
        self.store.apply('/api/phone/status',{'status':'waiting-phone','reason':'target-unavailable'})
        state=self.store.view()
        self.assertTrue(all(a.get('phoneError',{}).get('status')=='waiting-phone' for a in state['accounts']))
        self.assertIsNone(state['accounts'][1]['phoneReading'],'failure is never a fabricated zero')
        self.store.apply('/api/phone/status',{'status':'ready'})
        self.assertEqual(self.store.view()['accounts'][0].get('phoneError',{}).get('status'),'waiting-phone')
        self.store.apply('/api/phone/observation',self.observation())
        self.assertIsNone(self.store.view()['accounts'][0].get('phoneError'))


if __name__ == '__main__': unittest.main()
