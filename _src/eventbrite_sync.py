#!/usr/bin/env python3
"""Snapshot the SB27 Eventbrite ticket classes into _src/eventbrite.json (read-only API calls).

Run through the secret broker so the token never touches a file or the terminal:
  python3 ~/CC/agents/_kit/secretbroker.py run eventbrite-token --as EVENTBRITE_TOKEN -- python3 _src/eventbrite_sync.py

_src/build.mjs reads the snapshot and refuses to build if any price or date on the site
differs from Eventbrite. _src/ is not published (Jekyll skips folders that start with "_").
"""
import json, os, re, urllib.request, datetime, pathlib

EVENT = '1998827838873'
OUT = pathlib.Path(__file__).with_name('eventbrite.json')
TOKEN = os.environ['EVENTBRITE_TOKEN']


def get(path):
    req = urllib.request.Request('https://www.eventbriteapi.com/v3' + path, headers={'Authorization': 'Bearer ' + TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


ev = get(f'/events/{EVENT}/?expand=organizer,refund_policy')
classes, cont = [], None
while True:  # the ticket_classes endpoint rejects page_size; page with continuation
    d = get(f'/events/{EVENT}/ticket_classes/' + (f'?continuation={cont}' if cont else ''))
    classes += d['ticket_classes']
    if not d['pagination'].get('has_more_items'):
        break
    cont = d['pagination']['continuation']

out = []
for c in classes:
    m = re.match(r'\((\d+)\.(\d+) (\w+)\) - (.+)$', c['name'])
    out.append({
        'id': c['id'],
        'name': c['name'],
        'date': f'2027-{int(m.group(1)):02d}-{int(m.group(2)):02d}' if m else None,
        'party': m.group(4) if m else None,
        'free': bool(c.get('free')),
        'price': None if c.get('free') else c['cost']['major_value'],
        'currency': 'USD',
        'on_sale_status': c.get('on_sale_status'),
        'sales_start': c.get('sales_start'),
        'sales_end': c.get('sales_end'),
        'hidden': bool(c.get('hidden')),
        'description': c.get('description') or '',
    })

rp = ev.get('refund_policy') or {}
snap = {
    '_source': f'Eventbrite API GET /v3/events/{EVENT}/ticket_classes/ (read-only)',
    'read_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'event': {
        'id': EVENT, 'url': ev['url'], 'name': ev['name']['text'], 'status': ev['status'],
        'start': ev['start']['local'], 'end': ev['end']['local'], 'timezone': ev['start']['timezone'],
        'organizer_url': (ev.get('organizer') or {}).get('url'),
    },
    'refund_policy': {k: rp.get(k) for k in ('refund_policy', 'validity_days', 'is_refund_request_allowed',
                                              'is_attendee_automated_refund_allowed', 'refund_methods', 'refund_policy_description')},
    'ticket_classes': out,
}
OUT.write_text(json.dumps(snap, indent=1, ensure_ascii=False) + '\n')
print(f'eventbrite.json: {len(out)} ticket classes · event {ev["status"]} · refund {rp.get("validity_days")} days')
