"""Pinned full-output account-ledger parity with direct current numeric probes.

Typed compatibility fixtures and managed graph scenarios test the one native
accounting core. Bounded record identity/current-field parity does not certify
whole SDK coercion, prototypes, descriptors or the production frozen root.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = '07245602d6ff9bca0dcdf772134cba3dd227526c'
SOURCES = ['src/trading/Portfolio.ts', 'src/trading/capital.ts', 'src/trading/fees.ts',
           'src/trading/utils/rounding.ts', 'src/strategy/Strategy.ts']
MAP_FIELDS = ['positionsByAssetId', 'openOrdersByClientId', 'wsOpenOrdersByOrderId',
              'ordersByClientId', 'marketByAssetId']


def order(cid='a', size=800, **extra):
    return {'clientOrderId': cid, 'assetId': 'up', 'side': 'BUY', 'price': .6,
            'size': size, 'remaining': size, 'filled': 0, 'state': 'requested',
            'createdAtMs': 1000, 'updatedAtMs': 1000, 'market': 'old-market', **extra}


def submitted(cid='a', size=800, time=1000, **extra):
    return {'kind': 'order_submitted', 'tsMs': time, 'order': order(cid, size, **extra)}


def accepted(cid='a', oid='x', time=1001, **extra):
    return {'kind': 'order_accepted', 'tsMs': time, 'clientOrderId': cid, 'orderId': oid, **extra}


def fill(fid='f', size=300, time=1004, **extra):
    return {'kind': 'fill', 'fill': {'id': fid, 'tsMs': time, 'orderId': 'x',
        'assetId': 'up', 'side': 'BUY', 'price': .6, 'size': size,
        'liquidity': 'TAKER', 'feeRateBps': 700, **extra}}


def done(reason='canceled', **extra):
    return {'kind': 'order_done', 'tsMs': 1002, 'clientOrderId': 'a',
            'orderId': 'x', 'reason': reason, **extra}


def ws(oid='x', time=1003, **extra):
    return {'kind': 'ws_order_update', 'tsMs': time, 'order': {
        'orderId': oid, 'event': 'UPDATE', **extra}}


def split(sid='s', size=5, **extra):
    return {'kind': 'positions_split', 'split': {'id': sid, 'tsMs': 1000,
        'assetIdA': 'up', 'assetIdB': 'down', 'size': size, 'splitCost': size,
        'market': 'old-market', **extra}}


def merge(mid='m', size=5, **extra):
    return {'kind': 'positions_merged', 'id': mid, 'tsMs': 1001,
        'assetIdA': 'up', 'assetIdB': 'down', 'size': size, **extra}


def fixtures():
    cases = []

    def add(name, events=(), options=None, steps=None, **extra):
        rows = [{'event': copy.deepcopy(e)} for e in events] if steps is None else steps
        for step in rows:
            e=step.get('event',{})
            if e.get('kind')=='cancel_failed': e.update(operation=e.get('operation','cancel_order'),reason=e.get('reason','failure'))
            if e.get('kind') in ['split_failed','merge_failed']: e.update(assetIdA='up',assetIdB='down',requestedSize=2,reason='failure')
            if e.get('kind')=='account_stream_status': e.update(source='user_ws',status='disconnected',info='reconnect')
        cases.append({'name': name, 'input': {'initialNowMs': 9000000, 'steps': rows,
                      **({'options': options} if options is not None else {}), **extra}})

    add('empty')
    for first,second in [(0.0,-0.0),(-0.0,0.0),(-0.0,-0.0)]:
        add(f'public-snapshot-zero-clock-tie-{first!r}-{second!r}',[{'kind':'account_stream_status','tsMs':first},{'kind':'account_stream_status','tsMs':second}],initialNowMs=first,expectedClockBits='8000000000000000' if first.hex().startswith('-') and second.hex().startswith('-') else '0000000000000000')
    add('finite-input-derived-nonfinite', [fill('overflow',1e308,time=1,price=1e308,liquidity='MAKER')],initialNowMs=0,
        expectedSnapshotNumberBits={'/capital/cash':'fff0000000000000','/capital/availableCash':'fff0000000000000',
            '/positionsByAssetId/up/qty':'7ff0000000000000','/positionsByAssetId/up/avgEntryPrice':'7ff0000000000000',
            '/positionsByAssetId/up/costBasis':'7ff0000000000000'})
    add('finite-input-derived-nan', [fill('overflow',1e308,time=1,price=1e308,liquidity='MAKER'),
        fill('following',1,time=2,price=1,liquidity='MAKER')],initialNowMs=0,
        expectedSnapshotNaNPaths=['/positionsByAssetId/up/avgEntryPrice'])
    add('invalid-starting-capital', options={'startingCapital': -1})
    add('zero-starting-capital', [fill(size=1)], options={'startingCapital': 0})
    add('observation-clock-cache', steps=[{'initializeClock': 1000}, {'initializeClock': 2000},
        {'event': {'kind': 'cancel_failed', 'tsMs': 900}}, {'event': {'kind': 'split_failed', 'tsMs': 1100}},
        {'event': {'kind': 'merge_failed', 'tsMs': 950}}, {'event': {'kind': 'account_stream_status', 'tsMs': 1300}}])
    add('reference-stale-open-order-alias', [submitted(size=10), accepted(), fill(size=3),
        done('canceled', filledSize=3)], aliasProbe=True)
    add('reference-input-position-fill-split-meta-aliases', [submitted(size=10,meta={'probe':'original'}),
        fill(size=3,clientOrderId='a',intentMeta={'probe':'original'}),split()],mutableAliasesProbe=True)
    add('full-fill-done-late-status', [submitted(), accepted(), fill(size=800), done('filled'),
        ws(status='MINED'), ws(status='CONFIRMED'), ws(status='MATCHED'), ws(event='PLACEMENT')])
    add('unresolved-cancel-and-terminal-size-before-late-fill', [submitted(), accepted(),
        {'kind': 'cancel_failed', 'tsMs': 1002, 'reason': 'failure'}, done(),
        ws(event='CANCELLATION', status='CANCELED', originalSize=800, sizeMatched=300),
        fill(), fill(), ws(status='CONFIRMED')])
    add('done-filled-obligation-before-partial-and-final-fill',
        [submitted(), accepted(), done('filled'), fill('f1',300), fill('f2',500)])
    for reason in ['canceled', 'expired', 'killed']:
        for quantity in [None, 0, 300, 900, -1]:
            add(f'done-{reason}-quantity-{quantity}', [submitted(), accepted(),
                done(reason, **({} if quantity is None else {'filledSize': quantity})),
                fill('f',300), done(reason, filledSize=0)])
    add('funding-rejection-cannot-release-old-hold', [submitted(), accepted(), done(),
        {'kind': 'order_rejected', 'tsMs': 1003, 'clientOrderId': 'a', 'reason': 'insufficient_capital'}])
    add('submitted-replacement-rejection-preserves-old-generation', [submitted(), accepted(), done(),
        submitted(size=100, time=1003), {'kind': 'order_rejected', 'tsMs': 1004,
        'clientOrderId': 'a', 'reason': 'adapter_error'}, fill(size=300)])
    add('reused-client-late-old-open-cannot-touch-replacement', [submitted(), accepted(), done(filledSize=300),
        submitted(size=100,time=1003), fill('old',300,clientOrderId='a'),
        fill('new',100,orderId='new',clientOrderId='a'), accepted(oid='new',time=1005),
        {'kind':'order_open','tsMs':1006,'clientOrderId':'a','orderId':'x'}])
    add('closed-replacement-late-ack-cannot-merge-old-cash', [submitted(),accepted(),done(),
        submitted(size=100,time=1003),accepted(oid='new'),fill('new',100,orderId='new',clientOrderId='a'),
        done('filled',orderId='new'),accepted(oid='x',time=1006),fill('old',800)])
    for opening in ['order_accepted','order_open']:
        add(f'fill-before-submit-and-{opening}', [fill(size=3),submitted(size=10),
            {'kind':opening,'tsMs':1005,'clientOrderId':'a','orderId':'x'}])
        add(f'fill-before-ack-and-{opening}', [submitted(size=10),fill(size=3,clientOrderId='a'),
            {'kind':opening,'tsMs':1005,'clientOrderId':'a','orderId':'x'},fill('tail',7)])
    add('empty-client-is-not-nullish', [submitted(size=10),accepted(),
        fill(size=3,clientOrderId=''), {'kind':'order_open','tsMs':1006,'orderId':'x','clientOrderId':''},
        done('filled',clientOrderId='')])
    add('explicit-empty-order-id', [submitted(size=10,orderId=''),
        accepted(oid=''),fill(size=3,clientOrderId='a'),accepted(oid='x')])
    add('open-forces-open-after-partial-fill', [submitted(size=10),accepted(),fill(size=3),
        {'kind':'order_open','tsMs':1005,'orderId':'x'}])
    add('ws-manual-order-and-cash-before-link', [ws(side='BUY',price=.6,originalSize=800,sizeMatched=300),
        fill(size=300),submitted(),accepted(),ws(event='CANCELLATION',status='CANCELED',originalSize=800,sizeMatched=300)])
    add('ws-manual-order-missing-fields', [ws(price=.6),ws(side='SELL',price=.6,originalSize=10),
        ws(event='CANCELLATION'),ws(event='PLACEMENT',owner='o',market='m',assetId='up',side='BUY',
           price=.5,originalSize=20,sizeMatched=1,orderType='GTC',outcome='UP',expirationSec=99,createdAtSec=1)])
    add('ws-optional-empty-fields-omit-except-status-in-history', [submitted(),accepted(),
        ws(owner='',market='',assetId='',status='MINED',orderType='',outcome=''),ws(status='')])
    for status in ['MATCHED','MINED','CONFIRMED','RETRYING','FAILED','CANCELED','CANCELLED','EXPIRED','LIVE']:
        add(f'ws-status-{status}', [submitted(),accepted(),ws(status=status,sizeMatched=3,originalSize=800),fill(size=3),ws(status=status,sizeMatched=1)])
    add('ws-pending-status-progression-and-monotonic-clock', [ws(status='CONFIRMED',time=1100),
        submitted(size=10),accepted(),ws(status='MATCHED',time=900),ws(status='MINED',time=1200)])
    add('history-refresh-order-integer-object-keys', [submitted('10',1),submitted('2',1),submitted('a',1),
        submitted('01',1),submitted('4294967295',1),submitted('0',1),accepted('a'),accepted('10',oid='y')])
    add('fill-positions-object-integer-key-order', [fill(str(i),1,assetId=k,orderId='',liquidity='MAKER') for i,k in enumerate(['10','2','a','01','0','4294967295'])])
    add('taker-round-trip-realized-pnl', [fill('b',100,price=.5),fill('s',100,side='SELL',price=.6)])
    add('maker-stamped-fee-does-not-charge', [fill('b',100,price=.5,liquidity='MAKER'),fill('s',100,side='SELL',liquidity='MAKER')])
    add('oversell-fee-on-incoming-size-not-clamped-position', [fill('b',2),fill('s',5,side='SELL')])
    add('sell-with-no-position-still-cash-fee', [fill(side='SELL')])
    add('full-sell-clears-then-restores-explicit-market-map', [fill('b',10,market='old-market'),
        fill('s',10,side='SELL',market='new-market')])
    add('full-sell-with-open-order-retains-market', [submitted(size=1),fill('b',10,orderId=''),
        fill('s',10,side='SELL',orderId='')])
    add('metadata-and-order-options-preserved', [submitted(size=10,postOnly=False,orderType='GTD',expireAtMs=9000,
        lastError='',meta={'phase':'entry','decimal':'0.10000000000000001','nested':[None,True,{'2':'b','1':'a'}]}),
        accepted(),fill(size=2,intentMeta={'key':'value'},market='m'),done(filledSize=2)])
    add('raw-extra-fields-and-present-null-metadata', [submitted(size=10,meta=None,adapterTrace={'tick':9},oddString=''),
        accepted(),fill(size=2,intentMeta=None,adapterTrace={'index':1}),split(executionReceipt={'hash':'hash'})])
    for integer in [9007199254740993,-9007199254740993,9007199254740995,18446744073709551615,
                    -9223372036854775809,123456789012345678901234567890123456789,10**100+7]:
        opaque={'a':integer,'2':{'nested':[integer,{'10':integer,'1':integer}]},'1':integer,'01':integer,'0':integer}
        add(f'opaque-json-js-number-{integer}',[submitted(size=10,meta=opaque,opaqueOrder=opaque),
            fill(size=3,intentMeta=opaque,opaqueFill=opaque),split(opaqueSplit=opaque),accepted()])
    add('opaque-json-negative-zero', [submitted(size=10,meta={'negativeZero':-0.0,'positiveZero':0},opaqueOrder={'nested':[-0.0,0]}),
        fill(size=3,intentMeta={'negativeZero':-0.0},opaqueFill={'nested':[-0.0,0]}),split(opaqueSplit={'negativeZero':-0.0})])
    add('opaque-path-collision-negative-zero', [submitted(size=10,meta={'a/b':-0.0,'a':{'b':0},'a~b':-0.0},opaqueOrder={'a/b':-0.0,'a':{'b':0},'a~b':-0.0}),
        fill(size=3,intentMeta={'a/b':-0.0,'a':{'b':0},'a~b':-0.0})])
    add('post-only-commitments', [submitted(size=800,postOnly=True),accepted(),fill(size=300,liquidity='MAKER')])
    add('split-merge-cash-idempotency', [split(),split(),merge(),merge()])
    add('merge-before-mint-confirmed-collateral', [merge(),split(),merge()])
    add('split-mints-preserve-existing-basis', [fill(size=3),split(size=5),merge(size=2),fill('s',2,side='SELL')])
    add('merge-qty-clamp-preserves-basis-and-market-map', [fill('a',10),fill('b',5,assetId='down'),merge(size=3),merge('m2',99)])
    add('invalid-merge-consumes-id-invalid-split-does-not', [merge(assetIdB='up'),merge(),split(assetIdB='up'),split()])
    for size in [0,-1,.000000005,.000000015,1e-10,1e8]:
        for price in [0,1,-.1,.5,1.1]:
            add(f'fill-rounding-size-{size}-price-{price}', [fill(size=size,price=price),fill('s',size,side='SELL',price=price)])
    for limit in [-1,0,1,2.5,500]:
        add(f'recent-fill-limit-{limit}', [fill(str(i),1,price=.5) for i in range(7)],options={'maxRecentFills':limit})
    add('split-history-500-limit',steps=[{'event':split(str(i),1),'capture':i==501} for i in range(502)])
    add('fill-history-default-500-limit',steps=[{'event':fill(str(i),1,price=.5),'capture':i==501} for i in range(502)])
    # Stress actual fixed production prune thresholds with sparse capture.
    add('seen-id-prunes-oldest-5000-at-50001',steps=[{'event':fill(str(i),1,price=0,liquidity='MAKER'),'capture':False} for i in range(50001)]+[
        {'event':fill('0',1,price=0,liquidity='MAKER')},{'event':fill('5000',1,price=0,liquidity='MAKER')}])
    add('history-prunes-oldest-1000-at-10001',steps=[{'event':submitted(str(i),1),'capture':False} for i in range(10001)]+[
        {'event':accepted('9999',oid='r')},{'event':accepted('0',oid='pruned')}])
    add('pending-status-prunes-1000-at-10001',steps=[{'event':ws(str(i),status='CONFIRMED'),'capture':False} for i in range(10001)]+[
        {'event':submitted('a',1)},{'event':accepted('a',oid='0')},{'event':submitted('b',1)},{'event':accepted('b',oid='1000')}])
    add('terminal-prunes-one-at-50001',steps=[{'event':done(orderId=str(i),clientOrderId=''),'capture':False} for i in range(50001)]+[
        {'event':ws('0',event='PLACEMENT')},{'event':ws('1',event='PLACEMENT')}])
    # Refreshing a persistent mapping means its oldest generation must survive pruning.
    steps=[]
    for i in range(50001):
        steps += [{'event':submitted('a',1,orderId=str(i)),'capture':False}]
        if i==49999:
            steps += [{'event':submitted('a',1,orderId='0'),'capture':False}]
    steps += [{'event':submitted('a',1)},{'event':accepted('a',oid='0')},{'event':accepted('a',oid='1')}]
    add('persistent-id-refresh-and-prunes-5000',steps=steps)
    rng=random.Random(731984)
    for n in range(40):
        events=[]
        for i in range(60):
            cid=rng.choice(['a','b','c','']); oid=rng.choice(['x','y','z','']); timestamp=rng.randrange(900,1200)
            kind=rng.randrange(10)
            if kind==0: e=submitted(cid,rng.choice([1,3,10]),time=timestamp,assetId=rng.choice(['up','down']),postOnly=rng.choice([True,False]))
            elif kind==1: e=accepted(cid,oid,timestamp)
            elif kind==2: e={'kind':'order_open','tsMs':timestamp,'clientOrderId':cid,'orderId':oid}
            elif kind==3: e=done(rng.choice(['filled','canceled','expired','killed']),clientOrderId=cid,orderId=oid,tsMs=timestamp,filledSize=rng.choice([0,1,3]))
            elif kind==4: e=ws(oid,timestamp,status=rng.choice(['LIVE','MATCHED','MINED','CONFIRMED','CANCELED','']),originalSize=3,sizeMatched=rng.choice([0,1,3]),side=rng.choice(['BUY','SELL']),price=.6)
            elif kind==5: e={'kind':'order_rejected','tsMs':timestamp,'clientOrderId':cid,'reason':'reject'}
            elif kind==6: e=split(str(i),rng.choice([1,3]),tsMs=timestamp)
            elif kind==7: e=merge(str(i),rng.choice([1,3]),tsMs=timestamp)
            else: e=fill(str(rng.randrange(35)),rng.choice([1,2,3]),timestamp,clientOrderId=cid,orderId=oid,assetId=rng.choice(['up','down']),side=rng.choice(['BUY','SELL']),price=rng.choice([.1,.5,.6,.9]),liquidity=rng.choice(['MAKER','TAKER']))
            events.append(e)
        add(f'seeded-adverse-events-{n}',events,options={'startingCapital':rng.choice([0,500,1000.12345678]),'maxRecentFills':rng.choice([0,3,500])})
    add('managed-all-known-lifecycle-variants', [submitted(size=10),accepted(),
        {'kind':'order_open','tsMs':1002,'orderId':'x'},ws(status='MATCHED',originalSize=10,sizeMatched=2),
        fill(size=2,clientOrderId='a',liquidity='MAKER'),split(size=2),merge(size=1),
        {'kind':'cancel_failed','tsMs':1005,'clientOrderId':'a'},
        {'kind':'merge_failed','tsMs':1006},{'kind':'split_failed','tsMs':1007},
        {'kind':'account_stream_status','tsMs':1008},done('canceled',tsMs=1009,filledSize=2),
        submitted('b',1,time=1010),{'kind':'order_rejected','tsMs':1011,'clientOrderId':'b','reason':'adapter_error'}],
        managedEvents=True)
    def raw_case(name,operations,options=None):
        add(name,steps=[],rawAliasOperations=operations,options=options)
    def alloc(identity,event):return {'op':'allocate','id':identity,'event':event}
    def set_field(identity,path,value):return {'op':'set','id':identity,'path':path,'value':value}
    def apply_raw(identity):return {'op':'apply','id':identity}
    def retain(identity):return {'op':'retain','id':identity}
    def observe(label):return {'op':'observe','label':label}
    def selection(root,identity,path):return {'root':root,'id':identity,'path':path}
    def same(label,left,right):return {'op':'same','label':label,'left':left,'right':right}
    raw_case('raw-fill-current-slots-before-admission-processing',[
        alloc('f',fill('original',2,time=10,price=.5,liquidity='MAKER',intentMeta={'stage':'admitted'})),
        set_field('f',['fill','id'],'changed-before-processing'),set_field('f',['fill','size'],3),set_field('f',['fill','price'],.4),
        apply_raw('f'),retain('old'),observe('after-processing'),
        same('raw-fill-retained-identity',selection('event','f',['fill']),selection('snapshot','old',['recentFills','0'])),
    ])
    raw_case('raw-fill-retained-mutation-and-requeue-new-id',[
        alloc('f',fill('first',2,time=10,price=.5,liquidity='MAKER',intentMeta={'probe':'original'})),apply_raw('f'),retain('old'),
        set_field('f',['fill','id'],'second'),set_field('f',['fill','size'],3),set_field('f',['fill','price'],.4),set_field('f',['fill','intentMeta','probe'],'mutated'),
        observe('cached-after-mutation'),apply_raw('f'),retain('new'),observe('after-requeue'),
        same('repeated-history-payload-identity',selection('snapshot','new',['recentFills','0']),selection('snapshot','new',['recentFills','1'])),
    ])
    raw_case('raw-fill-same-id-requeue-does-not-account-twice',[
        alloc('f',fill('duplicate',2,time=10,price=.5,liquidity='MAKER')),apply_raw('f'),retain('old'),
        set_field('f',['fill','size'],100),set_field('f',['fill','price'],.9),apply_raw('f'),observe('duplicate-current-payload'),
    ])
    duplicate=fill('same-id',2,time=10,price=.5,liquidity='MAKER')
    raw_case('raw-distinct-equal-events-preserve-separate-identities',[
        alloc('first',duplicate),alloc('second',duplicate),apply_raw('first'),retain('old'),apply_raw('second'),
        same('distinct-equal-payloads',selection('event','first',['fill']),selection('event','second',['fill'])),
        set_field('second',['fill','id'],'second-id'),apply_raw('second'),retain('new'),observe('distinct-records'),
    ])
    raw_case('raw-split-retained-mutation-and-requeue-new-id',[
        alloc('s',split('first',2,tsMs=10,reason='original',executionReceipt={'status':'original'})),apply_raw('s'),retain('old'),
        set_field('s',['split','reason'],'mutated'),set_field('s',['split','executionReceipt','status'],'mutated'),
        set_field('s',['split','id'],'second'),set_field('s',['split','size'],3),set_field('s',['split','splitCost'],1),
        observe('cached-split-mutation'),apply_raw('s'),retain('new'),observe('split-requeue'),
        same('raw-split-retained-identity',selection('event','s',['split']),selection('snapshot','old',['recentSplits','0'])),
        same('repeated-split-history-identity',selection('snapshot','new',['recentSplits','0']),selection('snapshot','new',['recentSplits','1'])),
    ])
    raw_case('raw-fill-split-shared-metadata-reference',[
        alloc('f',fill('f',2,time=10,liquidity='MAKER',intentMeta={'probe':'original'})),alloc('s',split('s',1,tsMs=11)),
        {'op':'link','id':'s','path':['split','executionReceipt'],'source':selection('event','f',['fill','intentMeta'])},
        apply_raw('f'),apply_raw('s'),retain('old'),set_field('f',['fill','intentMeta','probe'],'shared-mutation'),observe('shared-meta'),
        same('metadata-shared-between-records',selection('snapshot','old',['recentFills','0','intentMeta']),selection('snapshot','old',['recentSplits','0','executionReceipt'])),
    ])
    raw_case('raw-envelope-current-kind-and-payload-switch',[
        alloc('a',fill('f',1,time=10,liquidity='MAKER')),alloc('b',split('s',2,tsMs=11)),
        apply_raw('a'),retain('old'),set_field('a',['kind'],'positions_split'),
        {'op':'link','id':'a','path':['split'],'source':selection('event','b',['split'])},
        apply_raw('a'),retain('new'),observe('switched-envelope-kind'),
        same('original-fill-retained-after-kind-switch',selection('event','a',['fill']),selection('snapshot','old',['recentFills','0'])),
    ])
    raw_case('raw-current-fill-payload-replaced-before-processing',[
        alloc('a',fill('a',2,time=1,price=.5,liquidity='MAKER')),
        alloc('b',fill('b',4,time=2,price=.25,liquidity='MAKER')),
        {'op':'link','id':'a','path':['fill'],'source':selection('event','b',['fill'])},
        apply_raw('a'),retain('old'),set_field('b',['fill','price'],.75),observe('same-replaced-payload'),
    ])
    raw_case('raw-fill-id-cycle-retains-prior-dedupe-identity',[
        alloc('a',fill('a',2,time=1,price=.5,liquidity='MAKER')),apply_raw('a'),retain('old'),
        set_field('a',['fill','id'],'b'),apply_raw('a'),set_field('a',['fill','id'],'a'),apply_raw('a'),observe('original-id-still-seen'),
    ])
    raw_case('raw-pruned-fill-kept-alive-by-old-snapshot',[
        alloc('first',fill('first',1,time=10,liquidity='MAKER')),alloc('second',fill('second',1,time=11,liquidity='MAKER')),
        apply_raw('first'),retain('old'),apply_raw('second'),retain('new'),set_field('first',['fill','size'],44),observe('old-membership-survives-prune'),
    ],options={'maxRecentFills':1})
    raw_case('raw-null-undefined-delete-reinsert-presence',[
        alloc('f',fill('f',1,time=10,liquidity='MAKER',intentMeta=None,feeRateBps=None,opaqueFill={'present':None})),apply_raw('f'),retain('old'),
        {'op':'set','id':'f','path':['fill','intentMeta']},{'op':'set','id':'f','path':['fill','opaqueFill','undefined']},observe('own-undefined'),
        {'op':'delete','id':'f','path':['fill','intentMeta']},set_field('f',['fill','intentMeta'],None),observe('reinsert-null'),
    ])
    raw_case('raw-invalid-fill-not-seen-until-current-fields-valid',[
        alloc('f',fill('f',0,time=10,price=-0.0,liquidity='MAKER')),apply_raw('f'),retain('empty'),
        set_field('f',['fill','size'],2),set_field('f',['fill','price'],.5),apply_raw('f'),retain('filled'),observe('corrected-raw-fill'),
    ])
    holder={'kind':'account_stream_status','tsMs':1,'source':'user_ws','status':'connected'}
    raw_case('position-current-mutation-cache-and-replacement',[
        alloc('f',fill('first',2,time=1,price=.5,liquidity='MAKER')),alloc('holder',holder),apply_raw('f'),retain('old'),
        {'op':'link','id':'holder','path':['probe'],'source':selection('snapshot','old',['positionsByAssetId','up'])},
        set_field('holder',['probe','qty'],8),set_field('holder',['probe','costBasis'],6),set_field('holder',['probe','avgEntryPrice'],.75),
        observe('external-record-mutation-does-not-invalidate-capital-cache'),
        alloc('next',fill('second',2,time=2,price=.5,liquidity='MAKER')),apply_raw('next'),retain('new'),observe('fill-reads-current-record-and-replaces-position'),
        same('fill-replaces-position-identity',selection('snapshot','old',['positionsByAssetId','up']),selection('snapshot','new',['positionsByAssetId','up'])),
    ])
    raw_case('position-split-and-merge-spreads-own-fields-and-references',[
        alloc('f',fill('first',2,time=1,price=.5,liquidity='MAKER')),alloc('holder',holder),apply_raw('f'),retain('old'),
        {'op':'link','id':'holder','path':['probe'],'source':selection('snapshot','old',['positionsByAssetId','up'])},
        set_field('holder',['probe','executionReceipt'],{'marker':'original'}),
        {'op':'set','id':'holder','path':['probe','ownUndefined']},
        alloc('s',split('s',2,tsMs=2)),apply_raw('s'),retain('minted'),observe('split-spreads-own-undefined-and-shared-reference'),
        same('split-replaces-position-identity',selection('snapshot','old',['positionsByAssetId','up']),selection('snapshot','minted',['positionsByAssetId','up'])),
        same('split-shares-nested-reference',selection('snapshot','old',['positionsByAssetId','up','executionReceipt']),selection('snapshot','minted',['positionsByAssetId','up','executionReceipt'])),
        alloc('m',merge('m',1,tsMs=3)),apply_raw('m'),retain('merged'),set_field('holder',['probe','executionReceipt','marker'],'later'),observe('merge-retains-spread-reference'),
    ])
    raw_case('position-missing-basis-falls-back-to-current-average',[
        alloc('f',fill('first',2,time=1,price=.5,liquidity='MAKER')),alloc('holder',holder),apply_raw('f'),retain('old'),
        {'op':'link','id':'holder','path':['probe'],'source':selection('snapshot','old',['positionsByAssetId','up'])},
        {'op':'delete','id':'holder','path':['probe','costBasis']},set_field('holder',['probe','avgEntryPrice'],.75),
        alloc('next',fill('second',2,time=2,price=.25,liquidity='MAKER')),apply_raw('next'),observe('fallback-current-average'),
    ])
    raw_case('order-original-payload-in-place-lifecycle-and-old-membership',[
        alloc('o',submitted(size=4,meta={'phase':'initial'})),apply_raw('o'),retain('submitted'),
        same('submission-keeps-original-order',selection('event','o',['order']),selection('snapshot','submitted',['openOrdersByClientId','a'])),
        alloc('ack',accepted()),apply_raw('ack'),retain('accepted'),observe('ack-mutates-old-order-reference'),
        same('accept-keeps-order-identity',selection('snapshot','submitted',['openOrdersByClientId','a']),selection('snapshot','accepted',['openOrdersByClientId','a'])),
        same('history-is-new-record',selection('snapshot','submitted',['ordersByClientId','a']),selection('snapshot','accepted',['ordersByClientId','a'])),
        alloc('f',fill('f',4,clientOrderId='a',liquidity='MAKER')),apply_raw('f'),retain('filled'),observe('fill-mutates-original-and-drops-current-membership'),
        alloc('done',done('filled',tsMs=1006)),apply_raw('done'),observe('terminal-history-update-after-full-fill'),
    ])
    raw_case('order-rejection-and-cancellation-mutate-retained-record',[
        alloc('o',submitted(size=4)),apply_raw('o'),retain('first'),
        alloc('reject',{'kind':'order_rejected','tsMs':1001,'clientOrderId':'a','reason':'adapter_error'}),apply_raw('reject'),observe('rejected-original-payload'),
        alloc('replacement',submitted(size=8,time=1002,meta={'generation':'second'})),apply_raw('replacement'),retain('replacement'),
        alloc('ack',accepted(time=1003)),apply_raw('ack'),
        alloc('cancel',done('canceled',tsMs=1004,filledSize=0)),apply_raw('cancel'),observe('canceled-original-payload'),
        same('replacement-has-new-identity',selection('snapshot','first',['openOrdersByClientId','a']),selection('snapshot','replacement',['openOrdersByClientId','a'])),
    ])
    raw_case('order-metadata-shares-history-until-reference-replacement',[
        alloc('o',submitted(size=4,meta={'phase':'initial'})),apply_raw('o'),retain('submitted'),
        alloc('ack',accepted()),apply_raw('ack'),retain('accepted'),
        same('initial-history-metadata-shared',selection('event','o',['order','meta']),selection('snapshot','submitted',['ordersByClientId','a','meta'])),
        set_field('o',['order','meta','phase'],'mutated'),observe('old-and-new-history-retain-shared-meta'),
        set_field('o',['order','meta'],{'phase':'replacement'}),
        alloc('open',{'kind':'order_open','tsMs':1002,'clientOrderId':'a','orderId':'x'}),apply_raw('open'),retain('opened'),observe('future-history-selects-new-meta-old-history-keeps-old-ref'),
        same('replacement-does-not-change-old-history-meta-identity',selection('snapshot','accepted',['ordersByClientId','a','meta']),selection('snapshot','opened',['ordersByClientId','a','meta'])),
    ])
    raw_case('current-order-mutations-drive-fills-without-changing-private-commitments',[
        alloc('o',submitted(size=10)),apply_raw('o'),alloc('ack',accepted()),apply_raw('ack'),retain('old'),
        set_field('o',['order','filled'],2),set_field('o',['order','size'],6),set_field('o',['order','remaining'],4),set_field('o',['order','price'],.25),
        observe('cached-order-fields-change-capital-keeps-copied-obligation'),
        alloc('f',fill('f',1,clientOrderId='a',liquidity='MAKER')),apply_raw('f'),retain('partial'),observe('current-filled-size-read'),
        alloc('d',done('canceled',tsMs=1006,filledSize=3)),apply_raw('d'),observe('cancel-current-order'),
    ])
    raw_case('current-history-mutations-spread-through-status-and-terminal',[
        alloc('o',submitted(size=4,meta={'phase':'initial'})),apply_raw('o'),alloc('ack',accepted()),apply_raw('ack'),retain('accepted'),alloc('holder',holder),
        {'op':'link','id':'holder','path':['history'],'source':selection('snapshot','accepted',['ordersByClientId','a'])},
        set_field('holder',['history','tradeStatusRank'],3),set_field('holder',['history','sizeMatched'],3),set_field('holder',['history','executionReceipt'],{'phase':'external'}),
        {'op':'set','id':'holder','path':['history','ownUndefined']},
        alloc('w',ws(status='MATCHED',originalSize=4,sizeMatched=1)),apply_raw('w'),retain('updated'),observe('ws-spreads-current-history-fields'),
        same('ws-new-history-record',selection('snapshot','accepted',['ordersByClientId','a']),selection('snapshot','updated',['ordersByClientId','a'])),
        same('ws-history-shares-opaque-extra-reference',selection('snapshot','accepted',['ordersByClientId','a','executionReceipt']),selection('snapshot','updated',['ordersByClientId','a','executionReceipt'])),
        alloc('d',done('canceled',tsMs=1006,filledSize=0)),apply_raw('d'),observe('terminal-reads-current-history-matched-size'),
    ])
    for name,next_event in [
        ('partial-fill',fill('f',1,clientOrderId='a')),
        ('complete-fill',fill('f',3,clientOrderId='a')),
        ('order-done',done()),
        ('order-rejected',{'kind':'order_rejected','tsMs':1002,'clientOrderId':'a','reason':'fixture-reject'}),
    ]:
        raw_case(f'order-mutated-client-id-keeps-resolved-map-key-{name}',[
            alloc('s',submitted(size=3,orderId='x')),apply_raw('s'),retain('before'),
            set_field('s',['order','clientOrderId'],'renamed'),alloc('next',next_event),apply_raw('next'),observe('after-current-client-id-mutation'),
        ])
    return cases


def is_nan_bits(value):
    if not isinstance(value,str) or len(value)!=16 or any(c not in '0123456789abcdef' for c in value):
        return False
    bits=int(value,16)
    return bits & 0x7ff0000000000000 == 0x7ff0000000000000 and bits & 0x000fffffffffffff != 0


def assert_snapshot_number_bits(expected,actual,path):
    if isinstance(expected,dict) and isinstance(actual,dict):
        expected,actual=[expected],[actual]
    if not isinstance(expected,list) or not isinstance(actual,list) or len(expected)!=len(actual):
        raise AssertionError(f'{path}: numeric snapshot count/type differs')
    for index,(left,right) in enumerate(zip(expected,actual)):
        if not isinstance(left,dict) or not isinstance(right,dict) or left.keys()!=right.keys():
            raise AssertionError(f'{path}[{index}]: numeric field presence differs')
        for key,bits in left.items():
            if is_nan_bits(bits) and is_nan_bits(right[key]):
                continue
            if bits!=right[key]:
                raise AssertionError(f'{path}[{index}]{key}: numeric bits/class differ: {bits!r} != {right[key]!r}')


def assert_equal(expected,actual,path='$'):
    if path.endswith('.snapshotNumberBits'):
        assert_snapshot_number_bits(expected,actual,path)
        return
    if isinstance(expected,dict):
        if not isinstance(actual,dict) or expected.keys()!=actual.keys():
            raise AssertionError(f'{path}: object field presence differs: expected={list(expected)} actual={list(actual) if isinstance(actual,dict) else actual}')
        for key in expected: assert_equal(expected[key],actual[key],f'{path}.{key}')
    elif isinstance(expected,list):
        if not isinstance(actual,list) or len(expected)!=len(actual): raise AssertionError(f'{path}: array length differs')
        for i,(a,b) in enumerate(zip(expected,actual)): assert_equal(a,b,f'{path}[{i}]')
    elif isinstance(expected,bool)!=isinstance(actual,bool):
        raise AssertionError(f'{path}: boolean/number differs')
    elif isinstance(expected,(int,float)) and not isinstance(expected,bool) and isinstance(actual,(int,float)):
        # JSON.stringify and Serde choose different shortest decimal spellings
        # for some large JS doubles. Compare binary64, while still rejecting
        # an unnormalized serde integer which carries nonrepresentable bits.
        if isinstance(actual,int) and float(actual)!=actual:
            raise AssertionError(f'{path}: native integer retains precision unavailable to JS Number: {actual}')
        if float(expected)!=float(actual): raise AssertionError(f'{path}: TS={expected!r}, Rust={actual!r}')
    elif expected!=actual:
        raise AssertionError(f'{path}: TS={expected!r}, Rust={actual!r}')


def check_comparator_mutations():
    mutations=[(0,False),(1,True),(False,0),(True,1),({'field':None},{}),
        ({}, {'field':None}), ([1,2],[2,1]),
        ({'mapKeys':{'ordersByClientId':['a','b']}},{'mapKeys':{'ordersByClientId':['b','a']}}),
        (9007199254740992,9007199254740993)]
    for expected,actual in mutations:
        try: assert_equal(expected,actual)
        except AssertionError: continue
        raise AssertionError('Differential comparator accepted a deliberate mutation')
    source={'snapshotNumberBits':[{'/qty':'7ff8000000000000'}]}
    for replacement in ['3ff0000000000000','7ff0000000000000','fff0000000000000','0000000000000000','8000000000000000',None]:
        target={'snapshotNumberBits':[{} if replacement is None else {'/qty':replacement}]}
        try: assert_equal(source,target)
        except AssertionError: continue
        raise AssertionError('Numeric snapshot comparator accepted NaN vs finite/Infinity/zero/missing')
    assert_equal(source,{'snapshotNumberBits':[{'/qty':'fff8000000000001'}]})
    for expected_bits,actual_bits in [('0000000000000000','8000000000000000'),('7ff0000000000000','fff0000000000000'),('3ff0000000000000','3ff0000000000001')]:
        try: assert_equal({'snapshotNumberBits':[{'/qty':expected_bits}]},{'snapshotNumberBits':[{'/qty':actual_bits}]})
        except AssertionError: continue
        raise AssertionError('Numeric snapshot comparator weakened finite/Infinity/signed-zero bits')
    assert_equal(0,0.0)
    return len(mutations)+9



def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node',default='/Users/mijat/.nvm/versions/node/v20.19.6/bin/node')
    parser.add_argument('--report',type=Path)
    parser.add_argument('--quick',action='store_true',help='Omit the fixed-boundary stress cases; never a complete check.')
    args=parser.parse_args()
    mutation_count=check_comparator_mutations()
    version=subprocess.check_output([args.node,'--version'],text=True).strip()
    if not version.startswith('v20.'): raise RuntimeError('Pinned production oracle requires Node 20')
    fingerprints={}
    for path in SOURCES:
        pinned=subprocess.check_output(['git','show',f'{REFERENCE}:{path}'],cwd=ROOT)
        if pinned!=(ROOT/path).read_bytes(): raise RuntimeError(f'Oracle source differs from reference commit: {path}')
        fingerprints[path]=digest(ROOT/path)
    wrappers=[Path(__file__).resolve(),ROOT/'scripts/rust-migration/portfolio-oracle.mts']
    crate=ROOT/'native/trading-runtime'
    native_sources=[p for folder in ['src','tests','examples'] for p in sorted((crate/folder).rglob('*.rs'))]
    native_sources += [crate/'Cargo.toml',crate/'Cargo.lock']
    wrapper_hashes={str(p.relative_to(ROOT)):digest(p) for p in wrappers+native_sources}
    cases=fixtures()
    if args.quick: cases=[c for c in cases if len(c['input']['steps'])<10000]
    payload=json.dumps({'cases':cases},separators=(',',':'))
    build=subprocess.run(['cargo','test','--manifest-path','native/trading-runtime/Cargo.toml','--test','portfolio','--locked','--offline','--no-run','--message-format=json'],cwd=ROOT,check=True,capture_output=True,text=True)
    binaries=[item['executable'] for line in build.stdout.splitlines() if (item:=json.loads(line)).get('reason')=='compiler-artifact' and item.get('executable') and item['target']['name']=='portfolio']
    if len(binaries)!=1: raise RuntimeError('Expected one compiled portfolio test adapter')
    with tempfile.TemporaryDirectory(prefix='rust-portfolio-parity-') as directory:
        directory=Path(directory); executable=Path(binaries[0]); before=digest(executable)
        frozen=directory/'portfolio-driver'; shutil.copy2(executable,frozen)
        if digest(frozen)!=before or digest(executable)!=before: raise RuntimeError('Native test executable changed while freezing')
        source=directory/'input.json'; target=directory/'output.json'; source.write_text(payload)
        expected=json.loads(subprocess.check_output([args.node,'--import','tsx',str(ROOT/'scripts/rust-migration/portfolio-oracle.mts'),str(source)],cwd=ROOT,text=True))
        environment={**os.environ,'PMB_PORTFOLIO_FIXTURE_INPUT':str(source),'PMB_PORTFOLIO_FIXTURE_OUTPUT':str(target)}
        subprocess.run([str(frozen),'differential_fixture_driver','--ignored','--exact'],cwd=ROOT,env=environment,check=True,capture_output=True,text=True)
        actual=json.loads(target.read_text())
        if digest(frozen)!=before: raise RuntimeError('Frozen native test executable changed')
    final_native_sources=[p for folder in ['src','tests','examples'] for p in sorted((crate/folder).rglob('*.rs'))]+[crate/'Cargo.toml',crate/'Cargo.lock']
    if set(final_native_sources)!=set(native_sources): raise RuntimeError('Native source file set changed during comparison')
    for path,original in {**fingerprints,**wrapper_hashes}.items():
        if digest(ROOT/path)!=original: raise RuntimeError(f'Source changed during comparison: {path}')
    if len(actual)!=len(cases) or len(expected)!=len(cases): raise AssertionError('Fixture response count differs from source case count')
    for source_case,left,right in zip(cases,expected,actual):
        if left['name']!=source_case['name'] or right['name']!=source_case['name']: raise AssertionError('Fixture identity/order differs from source')
        assert_equal(left['result'],right['result'],left['name'])
        source_case=next(c for c in cases if c['name']==left['name'])
        if 'expectedClockBits' in source_case['input']:
            expected_bits=source_case['input']['expectedClockBits']
            if left['result']['snapshotNumberBits'][-1]['/nowMs']!=expected_bits or right['result']['snapshotNumberBits'][-1]['/nowMs']!=expected_bits:
                raise AssertionError('Zero-clock fixture did not exercise its intended signed-zero result')
        for path,bits in source_case['input'].get('expectedSnapshotNumberBits',{}).items():
            if left['result']['snapshotNumberBits'][-1].get(path)!=bits or right['result']['snapshotNumberBits'][-1].get(path)!=bits:
                raise AssertionError(f'Direct typed numeric fixture failed to expose {path}')
        for path in source_case['input'].get('expectedSnapshotNaNPaths',[]):
            if not is_nan_bits(left['result']['snapshotNumberBits'][-1].get(path)) or not is_nan_bits(right['result']['snapshotNumberBits'][-1].get(path)):
                raise AssertionError(f'Direct typed numeric fixture failed to expose NaN at {path}')
    alias=next(row['referenceAliasing'] for row in expected if row['name']=='reference-stale-open-order-alias')
    if alias['retainedOpenOrder']['state']!='canceled' or alias['retainedHistory']['lifecycleState']!='requested':
        raise AssertionError('Reference stale-alias probe did not exercise mutable-open/immutable-history distinction')
    mutable_alias=next(row['mutableAliases'] for row in expected if row['name']=='reference-input-position-fill-split-meta-aliases')
    if not all(mutable_alias[key] for key in ['recentFillIsRawInput','recentSplitIsRawInput','openOrderIsRawInput','orderMetaIsShared']):
        raise AssertionError('Reference raw/metadata alias probe did not retain original object identities')
    if mutable_alias['currentAfterExternalMutation']['positionsByAssetId']['up']['qty']!=123:
        raise AssertionError('Reference external Position mutation was not observed by the ledger')
    report={'referenceCommit':REFERENCE,'oracleSourceSha256':fingerprints,'node':version,
        'nativeTestAdapterSha256':before,'nativeTestAdapterFrozenForExecution':True,
        'ownedSourceSha256':wrapper_hashes,'fixturesSha256':hashlib.sha256(payload.encode()).hexdigest(),
        'cases':len(cases),'eventCount':sum(len(c['input']['steps']) for c in cases),
        'fullCurrentSnapshotParity':True,'mapInsertionAndArrayOrderParity':True,
        'fixedPruneBoundariesIncluded':not args.quick,'comparatorMutationChecks':mutation_count,'fullKnownAccountEventEncodingParity':True,'opaqueJsonObjectKeyOrderParity':True,'opaqueMetadataBinary64BitsParity':True,'directTypedCurrentSnapshotNumberParity':True,'exactFiniteInfinityAndSignedZeroBits':True,'derivedNaNClassParity':True,'derivedNonfiniteSnapshotProbeParity':True,'nanEncodingComparisonDomain':'NaN classes compare equally; NaN payload/sign are implementation-chosen and no reviewed Portfolio strategy consumer inspects them. All finite/Infinity/signed-zero bits and numeric paths remain exact.','nanEncodingSpecification':['https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-number-type','https://tc39.es/ecma262/multipage/structured-data.html#sec-numerictorawbytes'],'snapshotNumberBitsDomain':'Current typed snapshot numbers captured before JSON projection, including finite values, signed zero and derived Infinity/NaN in the reviewed corpus; raw UTF16/overflow metadata and mutable record aliases remain separate SDK requirements','nativeBuildLockedOffline':True,'numericComparison':'JavaScript binary64 with rejection of unnormalized native integer precision','opaqueControlDomain':'Finite Unicode-scalar Value trees normalized through shared market_json; lossless raw UTF16/overflow SDK metadata remains a separate integration requirement',
        'staleOpenOrderAliasParity':False,'remainingDependency':'Complete graph-backed WS records, the single shallow-frozen snapshot/capital root and mutable memberships, generic coercion/exception/prototype/descriptor behavior, and actual runner/OrderManager/strategy integration. Current managed numeric/string record parity is bounded to the declared oracle cases.',
        'referenceAliasingProbe':alias,'referenceMutablePayloadAliasesProbe':mutable_alias,'mutableRawPayloadPositionMetadataAliasParity':False,'rawFillSplitPayloadIdentityParity':True,'rawFillSplitCurrentSlotAccountingParity':True,'retainedRawFillSplitCacheMembershipParity':True,'rawFillSplitAliasScenarioCount':sum(c['name'].startswith('raw-') and 'rawAliasOperations' in c['input'] for c in cases),'rawFillSplitAliasOperationCount':sum(len(c['input'].get('rawAliasOperations',[])) for c in cases if c['name'].startswith('raw-')),'managedGraphAliasScenarioCount':sum('rawAliasOperations' in c['input'] for c in cases),'managedGraphAliasOperationCount':sum(len(c['input'].get('rawAliasOperations',[])) for c in cases),'boundedManagedAccountLifecycleCurrentFieldParity':True,'boundedAuthoritativePositionOpenOrderHistoryParity':True,'boundedRecordDomain':'Schema-bound original envelope/payload records, numeric financial slots, Unicode-scalar string IDs/enums, data properties and shared opaque graph references in the declared fixtures. Generic JS coercion/prototype/descriptor and full production snapshot root semantics remain required.','nativeSourceFileSetGuarded':True,'responseSourceIdentityBound':True}
    if args.report: args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
