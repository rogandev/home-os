"""Local-only browser contract test. Requires a disposable API and Copy-enabled Vite.
Run: API_BASE_URL=http://127.0.0.1:3301 API_TOKEN=... python tests/browser/inventory-copy.py
Dependencies: Python Playwright and Chromium (CHROMIUM_PATH optional).
"""
import json, os, uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

API = os.environ.get('API_BASE_URL', 'http://127.0.0.1:3301')
UI = os.environ.get('UI_BASE_URL', 'http://localhost:5173')
assert urlparse(API).hostname in ['127.0.0.1', 'localhost', '::1'], 'Use a disposable local API only'
assert urlparse(UI).hostname in ['127.0.0.1', 'localhost', '::1'], 'Use a local UI only'
TOKEN = os.environ['API_TOKEN']
ARTIFACTS = Path(os.environ.get('QA_ARTIFACTS', '/tmp/home-copy-qa'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    api = p.request.new_context(base_url=API, extra_http_headers={'Authorization': f'Bearer {TOKEN}'})
    def req(path, method='GET', data=None):
        r = api.fetch('/home-os' + path, method=method, data=data)
        assert r.ok, f'{method} {path}: {r.status} {r.text()}'
        return r.json()
    tag = 'Copy E2E ' + uuid.uuid4().hex[:8]
    fields = dict(name=tag, brand='Sample Brand', category='Skin Care', description='Gentle daily cleanser',
                  size='100 ml', form='Bottle', notes='Keep upright', quantity=3, reorder_at=2,
                  location='Walk-in Closet', replenishmentPolicy='auto_replenish')
    rows = [dict(containerId='bathroom-tims-blue-box', quantity=2),
            dict(containerId='bathroom-kiehls-bag-1', quantity=1),
            dict(containerId='walk-in-closet-backstock-bin', quantity=0)]
    source = req('/items', 'POST', dict(**fields, allocations=rows, createRequestId=str(uuid.uuid4())))
    source_id = source['id']
    order = req(f'/items/{source_id}/orders', 'POST', dict(quantity=4))
    original = req(f'/items/{source_id}')
    original_rows = req(f'/items/{source_id}/stock-allocations')
    original_orders = req('/orders?status=all')
    original_events = req(f'/orders/{order["id"]}/events')
    count_before = len(req('/items'))
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 820, 'height': 1180}, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    requests = []
    page.on('request', lambda r: requests.append((r.method, r.url, r.post_data)) if r.method != 'GET' else None)
    page.goto(UI)
    expect(page.get_by_role('button', name=f'Copy {tag}', exact=True)).to_be_visible()
    def open_copy():
        page.locator(f'[data-item-id="{source_id}"]').get_by_role('button', name=f'Copy {tag}', exact=True).click()
        modal = page.get_by_role('dialog', name='Copy Item', exact=True)
        expect(modal).to_be_visible()
        return modal
    modal = open_copy()
    for label, value in [('Product name', tag), ('Brand', fields['brand']), ('Description', fields['description']),
                         ('Size', '100 ml'), ('Form', 'Bottle'), ('Notes', fields['notes']), ('Quantity', '3'), ('Reorder at', '2')]:
        expect(modal.get_by_label(label, exact=True)).to_have_value(value)
    expect(modal.get_by_role('button', name='Replenishment', exact=True)).to_contain_text('Auto-replenish')
    assert modal.get_by_role('button', name='Location', exact=True).inner_text().startswith('Walk-in Closet')
    page.screenshot(path=str(ARTIFACTS/'copy-ipad-portrait.png'))
    # Cancel, X, Escape and backdrop all leave inventory and source untouched.
    modal.get_by_label('Size', exact=True).fill('250 ml')
    modal.get_by_role('button', name='Cancel', exact=True).click()
    expect(modal).not_to_be_visible()
    for close_kind in ['x', 'escape', 'backdrop']:
        modal = open_copy()
        if close_kind == 'x': modal.get_by_role('button', name='Close Copy Item', exact=True).click()
        elif close_kind == 'escape': page.keyboard.press('Escape')
        else: page.mouse.click(2, 2)
        expect(modal).not_to_be_visible()
    assert requests == [], requests
    assert len(req('/items')) == count_before
    assert req(f'/items/{source_id}') == original
    # Size-only save, rapid repeated clicks: a single independent item.
    modal = open_copy()
    modal.get_by_label('Size', exact=True).fill('200 ml')
    modal.get_by_role('button', name='Save Copy', exact=True).evaluate('(button) => { button.click(); button.click(); }')
    expect(modal).not_to_be_visible()
    created = [i for i in req('/items') if i['name'] == tag and i['id'] != source_id]
    assert len(created) == 1
    copy = created[0]
    assert copy['id'] != source_id
    for key, value in fields.items(): assert copy[key] == ('200 ml' if key == 'size' else value), (key, copy[key], value)
    assert copy['status'] != 'awaiting_shipment'
    copied_rows = req(f'/items/{copy["id"]}/stock-allocations')
    assert [{k:r[k] for k in ['containerId','quantity']} for r in copied_rows] == [{k:r[k] for k in ['containerId','quantity']} for r in original_rows]
    assert all(row['itemId'] == copy['id'] for row in copied_rows)
    assert req(f'/items/{source_id}') == original
    assert req(f'/items/{source_id}/stock-allocations') == original_rows
    assert req('/orders?status=all') == original_orders
    assert req(f'/orders/{order["id"]}/events') == original_events
    posts = [r for r in requests if r[0] == 'POST' and r[1].endswith('/items')]
    assert len(posts) == 1
    body = json.loads(posts[0][2])
    assert not set(body) & {'id','status','created_at','updated_at','orders','history'}
    # Lost response after a real DB commit: same frozen body/key recovers once.
    dropped = []
    def drop_once(route):
        if route.request.method != 'POST': return route.continue_()
        dropped.append(route.request.post_data)
        response = route.fetch()
        assert response.status == 201
        if len(dropped) == 1: route.abort('failed')
        else: route.fulfill(response=response)
    page.route('**/home-os/items', drop_once)
    modal = open_copy()
    modal.get_by_label('Size', exact=True).fill('300 ml')
    modal.get_by_role('button', name='Save Copy', exact=True).click()
    expect(modal.get_by_role('alert')).to_contain_text('Retry')
    expect(modal.get_by_label('Size', exact=True)).to_be_disabled()
    expect(modal.get_by_role('button', name='Close Copy Item', exact=True)).to_be_disabled()
    expect(modal.get_by_role('button', name='Cancel', exact=True)).to_be_disabled()
    page.keyboard.press('Escape')
    expect(modal).to_be_visible()
    modal.get_by_role('button', name='Retry Save Safely', exact=True).click()
    expect(modal).not_to_be_visible()
    assert len(dropped) == 2 and dropped[0] == dropped[1]
    assert len([i for i in req('/items') if i['name'] == tag and i['size'] == '300 ml']) == 1
    page.unroute('**/home-os/items', drop_once)
    # Mobile and iPad landscape: modal stays within viewport; stock controls are reachable.
    for width, height, name in [(390,844,'mobile'), (1024,768,'ipad-landscape')]:
        page.set_viewport_size({'width':width,'height':height})
        modal = open_copy()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        bounds = modal.locator('.modal-panel').bounding_box()
        assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width
        modal.get_by_label("Tim's Blue Box copy quantity", exact=True).fill('4')
        expect(modal.get_by_label('Quantity', exact=True)).to_have_value('5')
        modal.get_by_role('button', name='Save Copy', exact=True).scroll_into_view_if_needed()
        page.screenshot(path=str(ARTIFACTS/f'copy-{name}-storage.png'))
        modal.get_by_role('button', name='Cancel', exact=True).click()
    # Empty and zero allocations remain empty/zero on an independent save.
    for label, zero_rows in [('empty', []), ('zero', [dict(containerId='walk-in-closet-backstock-bin',quantity=0)])]:
        name = tag + ' ' + label
        zero = req('/items', 'POST', dict(**{**fields,'name':name,'quantity':0}, allocations=zero_rows, createRequestId=str(uuid.uuid4())))
        page.reload()
        page.get_by_role('button', name=f'Copy {name}', exact=True).click()
        modal = page.get_by_role('dialog', name='Copy Item', exact=True)
        expect(modal.get_by_label('Quantity', exact=True)).to_have_value('0')
        modal.get_by_role('button', name='Save Copy', exact=True).click()
        expect(modal).not_to_be_visible()
        new = [i for i in req('/items') if i['name']==name and i['id']!=zero['id']]
        assert len(new)==1 and new[0]['quantity']==0
        assert [{k:r[k] for k in ['containerId','quantity']} for r in req(f'/items/{new[0]["id"]}/stock-allocations')] == zero_rows
    # Failed storage read blocks Copy rather than silently losing assignments.
    page.route(f'**/home-os/items/{source_id}/stock-allocations', lambda route: route.fulfill(status=500,json={'error':'fixture unavailable'}))
    page.reload()
    page.locator(f'[data-item-id="{source_id}"]').get_by_role('button', name=f'Copy {tag}', exact=True).click()
    expect(page.get_by_role('dialog', name='Copy Item', exact=True)).not_to_be_visible()
    expect(page.get_by_role('alert').filter(has_text='Reload before copying')).to_be_visible()
    page.unroute(f'**/home-os/items/{source_id}/stock-allocations')
    page.reload()
    # Legacy Add: a committed create plus failed allocation GET is success, never a second save.
    source_ids = {i['id'] for i in req('/items')}
    def fail_new_allocations(route):
        item_id = int(route.request.url.split('/items/')[1].split('/')[0])
        if item_id not in source_ids: route.fulfill(status=500,json={'error':'fixture unavailable'})
        else: route.continue_()
    page.route('**/home-os/items/*/stock-allocations', fail_new_allocations)
    page.get_by_role('button', name='+ Add Item', exact=True).click()
    add = page.get_by_role('dialog', name='Add Item', exact=True)
    add.get_by_label('Product name', exact=True).fill(tag + ' legacy add')
    add.get_by_role('button', name='Save Item', exact=True).click()
    expect(add).not_to_be_visible()
    assert len([i for i in req('/items') if i['name']==tag+' legacy add']) == 1
    assert req(f'/items/{source_id}') == original
    assert not errors, errors
    (ARTIFACTS/'browser-result.json').write_text(json.dumps({'passed':True,'sourceId':source_id,'independentCopyId':copy['id'],'consoleErrors':errors,'viewports':[[820,1180],[390,844],[1024,768]],'cases':['cancel/close/escape/backdrop zero writes','size-only preserve all fields','deep zero/multi allocations','rapid duplicate click','lost committed response retry','mobile/iPad layout','empty/zero allocation save','source unchanged','orders/history unchanged','storage read failure blocks copy','legacy add refresh failure no duplicate']},indent=2))
    print('PASS: browser → local API → PostgreSQL copy flow; 11 acceptance groups, mobile/iPad, no page errors')
    browser.close()
