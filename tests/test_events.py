import copy
from datetime import datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import get_events as g

BUILDINGS = json.loads((g.ROOT / 'buildings.json').read_text(encoding='utf-8'))


def event(source='fiu_calendar', id='1', **changes):
    values = dict(source=source, source_id=id, title='Career fair', link='https://calendar.fiu.edu/event/fair',
                  start='2026-09-28T12:00:00-04:00', end='2026-09-28T16:00:00-04:00',
                  location='Graham Center', buildings=BUILDINGS)
    values.update(changes)
    return g.make_event(**values)


def page(number, total=2):
    return json.dumps({'page': {'current': number, 'total': total, 'next_page': number + 1 if number < total else None},
                       'events': [{'event': {'id': 10, 'title': 'Weekly club', 'localist_url': 'https://calendar.fiu.edu/event/club',
                         'location_name': 'GC 150', 'event_instances': [{'event_instance': {
                         'id': number, 'start': f'2026-10-0{number}T16:00:00-04:00', 'end': None}}]}}]})


class EventsTest(unittest.TestCase):
    def test_aliases_and_room_codes(self):
        for location, code in [('Graham Center', 'GC'), ('gc by Bustelo', None), ('GC279A', 'GC'),
                               ('Steven & Dorothea Green Library', 'GL'), ('SIPA II 216', 'SIPA2'),
                               ('PCA 135', 'PCA'), ('Charles Perry', 'PC')]:
            found = g.resolve_building(location, BUILDINGS)
            self.assertEqual(found['abbreviation'] if found else None, code)

    def test_ambiguous_or_virtual_locations_are_not_guessed(self):
        for location in ['Unknown Location', 'An online event at GC', 'BBC WRC', 'Biscayne Bay Campus',
                         'https://fiu.zoom.us/j/123', 'meet us as a group', 'GC / GL', 'FIU in DC']:
            self.assertIsNone(g.resolve_building(location, BUILDINGS))

    def test_cancellations(self):
        self.assertIsNone(event(status='cancelled'))
        self.assertIsNone(event(title='Canceled: Career fair'))

    def test_dates_dst_and_unknown_end(self):
        winter = event(start='2026-11-02T12:00:00-05:00', end=None)
        self.assertEqual(winter['start time'], '2026-11-02T17:00:00Z')
        self.assertEqual(winter['expires_at'], '2026-11-03T05:00:00Z')
        self.assertIsNone(winter['end time'])
        self.assertEqual(event()['start time'], '2026-09-28T16:00:00Z')

    def test_bad_times_fail_validation(self):
        with self.assertRaises(ValueError): event(end='2026-09-27T12:00:00Z')
        with self.assertRaises(ValueError): event(start='not a date')

    def test_invalid_coordinates_and_virtual(self):
        self.assertIsNone(event(location='Not mapped', geo={'latitude':'NaN', 'longitude':'0'})['latitude'])
        self.assertIsNone(event(experience='virtual')['latitude'])
        self.assertIsNone(event(location='Not mapped')['latitude'])
        elsewhere = event(location='GC', geo={'latitude':38.9, 'longitude':-77.0})
        self.assertIsNone(elsewhere['building_id'])
        self.assertEqual(elsewhere['latitude'],38.9)

    def test_repeat_pages_are_deduped_but_recurrences_kept(self):
        items = [event(), event(), event(id='2',start='2026-09-29T12:00:00-04:00',end=None)]
        self.assertEqual(len(g.deduplicate(items)),2)

    def test_cross_source_duplicate_retains_both_references(self):
        items = g.deduplicate([event(), event('panther_connect','99',location='Ernest R. Graham Center')])
        self.assertEqual(len(items),1)
        self.assertEqual(len(items[0]['sources']),2)

    def test_distinct_rooms_and_same_source_sessions_stay_separate(self):
        items = [event(location='GC 150'),event('panther_connect','99',location='GC 243')]
        self.assertEqual(len(g.deduplicate(items)),2)
        self.assertEqual(len(g.deduplicate([event(),event(id='2')])),2)

    def test_rss_namespaces_multiple_hosts_and_plain_text(self):
        xml = '''<rss><channel><item><title>A &amp; B</title><guid>123</guid><link>https://example.com/1</link>
            <description>&lt;b&gt;Hello&lt;/b&gt;</description><start xmlns="events">Sun, 27 Sep 2026 18:00:00 GMT</start>
            <end xmlns="events">Sun, 27 Sep 2026 20:00:00 GMT</end><location xmlns="events">GC</location>
            <host xmlns="events">One</host><host xmlns="events">Two</host></item></channel></rss>'''
        items, _ = g.parse_rss(xml, BUILDINGS)
        self.assertEqual(items[0]['host'],'One, Two')
        self.assertEqual(items[0]['description'],'Hello')
        self.assertEqual(items[0]['building_id'],'GC')

    def test_pagination_visits_every_page(self):
        urls=[]
        def fetch(url):
            urls.append(url)
            return page(len(urls))
        events, pages = g.fetch_calendar('2026-09-26',90,BUILDINGS,fetch)
        self.assertEqual(pages,2)
        self.assertEqual(len(events),2)
        self.assertIn('page=2',urls[1])

    def test_repeated_or_missing_page_rejected(self):
        with self.assertRaises(ValueError):
            g.fetch_calendar('2026-09-26',90,BUILDINGS,lambda url: page(1))
        with self.assertRaises(ValueError):
            g.fetch_calendar('2026-09-26',90,BUILDINGS,lambda url: '{}')

    def test_failed_refresh_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp)/'events.json';dest.write_text('old feed')
            with patch('sys.argv',['get_events.py','--output',str(dest)]), patch.object(g,'build_feed',side_effect=OSError('source unavailable')):
                with self.assertRaises(OSError): g.main()
            self.assertEqual(dest.read_text(),'old feed')

    def test_atomic_publish_and_safe_links(self):
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp)/'events.json';g.atomic_write(dest,{'events':[]})
            self.assertEqual(json.loads(dest.read_text()),{'events':[]})
            self.assertEqual(list(Path(temp).glob('*.tmp')),[])
        self.assertEqual(event(link='javascript:alert(1)')['link'],'')


if __name__ == '__main__': unittest.main()
