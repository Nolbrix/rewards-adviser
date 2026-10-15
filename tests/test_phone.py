import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest


spec = importlib.util.spec_from_file_location(
    'phone_adviser_server', Path(__file__).parents[1] / 'companion/server.py'
)
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class ManualReadActivityTests(unittest.TestCase):
    def test_confirmed_read_points_determine_earned_total_and_status(self):
        cases = [
            (0, 'complete', 'incomplete'),
            (1, 'complete', 'incomplete'),
            (15, 'unknown', 'incomplete'),
            (29, 'complete', 'incomplete'),
            (30, 'incomplete', 'complete'),
        ]
        for confirmed, supplied_status, expected_status in cases:
            with self.subTest(confirmed=confirmed):
                result = server_module.activity({
                    'id': 'manual-read', 'title': 'Articoli Bing',
                    'status': supplied_status, 'total': 5, 'earned': 999,
                    'confirmedPoints': confirmed,
                }, manual=True, today='2026-10-15')
                self.assertEqual(result['earned'], confirmed)
                self.assertEqual(result['total'], 30)
                self.assertEqual(result['status'], expected_status)
                self.assertEqual(result['category'], 'phone')
                self.assertEqual(result['source'], 'manual')
                self.assertNotIn('confirmedPoints', result)

    def test_read_without_confirmation_keeps_legacy_status_with_default_total(self):
        missing = object()
        for total in (missing, None):
            for confirmed in (missing, None):
                for status, expected_earned in [
                    ('unknown', None), ('incomplete', 0),
                    ('complete', 30), ('not-applicable', None),
                ]:
                    with self.subTest(total=total, confirmed=confirmed, status=status):
                        raw = {'id': 'manual-read', 'title': 'Articoli Bing', 'status': status}
                        if total is not missing:
                            raw['total'] = total
                        if confirmed is not missing:
                            raw['confirmedPoints'] = confirmed
                        result = server_module.activity(raw, manual=True, today='2026-10-15')
                        self.assertEqual(result['total'], 30)
                        self.assertEqual(result['status'], status)
                        self.assertEqual(result['earned'], expected_earned)
                        self.assertNotIn('confirmedPoints', result)

    def test_unconfirmed_read_does_not_trust_direct_earned_input(self):
        for status, expected_earned in [('unknown', None), ('incomplete', 0), ('complete', 30)]:
            with self.subTest(status=status):
                result = server_module.activity({
                    'id': 'manual-read', 'title': 'Articoli Bing',
                    'status': status, 'total': 30, 'earned': 12,
                }, manual=True, today='2026-10-15')
                self.assertEqual(result['earned'], expected_earned)
                self.assertEqual(result['status'], status)

    def test_confirmed_read_points_reject_invalid_types_and_out_of_range_values(self):
        invalid_values = [True, False, '0', '15', '', 0.0, 15.0, 1.5, -1, 31, [], {}]
        for confirmed in invalid_values:
            with self.subTest(confirmed=confirmed):
                with self.assertRaises(ValueError):
                    server_module.activity({
                        'id': 'manual-read', 'title': 'Articoli Bing',
                        'status': 'incomplete', 'total': 30,
                        'confirmedPoints': confirmed,
                    }, manual=True, today='2026-10-15')

    def test_other_manual_activities_cannot_use_confirmed_points(self):
        for activity_id in ('manual-checkin', 'checkin', 'manual-custom'):
            for confirmed in (0, 10, 30):
                with self.subTest(activity_id=activity_id, confirmed=confirmed):
                    with self.assertRaises(ValueError):
                        server_module.activity({
                            'id': activity_id, 'title': 'Check-in',
                            'status': 'incomplete', 'total': 10,
                            'confirmedPoints': confirmed,
                        }, manual=True, today='2026-10-15')

    def test_checkin_keeps_legacy_all_or_none_progress(self):
        for activity_id in ('manual-checkin', 'checkin'):
            for status, expected_earned in [
                ('unknown', None), ('incomplete', 0),
                ('complete', 10), ('not-applicable', None),
            ]:
                with self.subTest(activity_id=activity_id, status=status):
                    result = server_module.activity({
                        'id': activity_id, 'title': 'Check-in', 'status': status,
                        'total': 10, 'earned': 7, 'confirmedPoints': None,
                    }, manual=True, today='2026-10-15')
                    self.assertEqual(result['status'], status)
                    self.assertEqual(result['earned'], expected_earned)
                    self.assertEqual(result['total'], 10)
                    self.assertNotIn('confirmedPoints', result)

    def test_checkin_with_unknown_total_is_not_given_an_article_quota(self):
        result = server_module.activity({
            'id': 'manual-checkin', 'title': 'Check-in',
            'status': 'complete', 'total': None, 'earned': 7,
        }, manual=True, today='2026-10-15')
        self.assertIsNone(result['total'])
        self.assertIsNone(result['earned'])
        self.assertEqual(result['status'], 'complete')

    def test_manual_activity_date_is_supplied_by_the_server(self):
        result = server_module.activity({
            'id': 'manual-read', 'title': 'Articoli Bing', 'status': 'incomplete',
            'total': 30, 'date': '2000-01-01',
        }, manual=True, today='2026-10-15')
        self.assertEqual(result['date'], '2026-10-15')


class ManualReadStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = server_module.Store(Path(self.temp.name))

    def test_partial_article_progress_survives_api_state_and_reload(self):
        response = self.store.apply('/api/manual', {'slot': 1, 'activities': [{
            'id': 'manual-read', 'title': 'Articoli Bing',
            'status': 'complete', 'total': None, 'earned': 30,
            'confirmedPoints': 12,
        }]})
        current = response['state']['accounts'][0]['manual'][0]
        restored = server_module.Store(Path(self.temp.name))
        reloaded = restored.view()['accounts'][0]['manual'][0]
        for saved in (current, reloaded):
            with self.subTest(saved=saved):
                self.assertEqual(saved['earned'], 12)
                self.assertEqual(saved['total'], 30)
                self.assertEqual(saved['status'], 'incomplete')
                self.assertEqual(saved['source'], 'manual')
                self.assertNotIn('confirmedPoints', saved)
        persisted = json.loads((Path(self.temp.name) / 'state.json').read_text(encoding='utf-8'))
        self.assertNotIn('confirmedPoints', json.dumps(persisted))

    def test_manual_api_stamps_today_instead_of_accepting_a_submitted_date(self):
        response = self.store.apply('/api/manual', {'slot': 1, 'activities': [{
            'id': 'manual-read', 'title': 'Articoli Bing',
            'status': 'incomplete', 'confirmedPoints': 15, 'date': '2000-01-01',
        }]})
        saved = response['state']['accounts'][0]['manual'][0]
        self.assertEqual(saved['date'], server_module.day_key('Europe/Rome'))

    def test_rejected_confirmation_preserves_previous_manual_progress(self):
        self.store.apply('/api/manual', {'slot': 1, 'activities': [{
            'id': 'manual-checkin', 'title': 'Check-in', 'status': 'complete', 'total': 10,
        }]})
        before = self.store.view()['accounts'][0]['manual']
        with self.assertRaises(ValueError):
            self.store.apply('/api/manual', {'slot': 1, 'activities': [{
                'id': 'manual-checkin', 'title': 'Check-in', 'status': 'incomplete',
                'total': 10, 'confirmedPoints': 5,
            }]})
        self.assertEqual(self.store.view()['accounts'][0]['manual'], before)

    def test_page_snapshot_cannot_enable_manual_confirmed_points(self):
        self.store.apply('/api/heartbeat', {
            'clientId': 'reader-phone',
            'config': {'slot': 1, 'alias': 'Account 1', 'browser': 'Chrome'},
        })
        response = self.store.apply('/api/snapshot', {
            'clientId': 'reader-phone',
            'snapshot': {
                'date': server_module.day_key('Europe/Rome'),
                'observedAt': int(time.time() * 1000),
                'account': {'email': 'reader@example.com'},
                'activities': [{
                    'id': 'manual-read', 'title': 'Articoli Bing', 'category': 'phone',
                    'status': 'incomplete', 'total': 10, 'earned': 3,
                    'source': 'manual', 'confirmedPoints': 30,
                }],
                'coverage': {}, 'diagnostics': {'recognized': True},
            },
        })
        account = response['state']['accounts'][0]
        normalized = account['snapshot']['activities'][0]
        self.assertEqual(normalized['earned'], 3)
        self.assertEqual(normalized['total'], 10)
        self.assertEqual(normalized['status'], 'incomplete')
        self.assertEqual(normalized['source'], 'page')
        self.assertNotIn('confirmedPoints', normalized)
        self.assertEqual(account['manual'], [])


if __name__ == '__main__':
    unittest.main()
