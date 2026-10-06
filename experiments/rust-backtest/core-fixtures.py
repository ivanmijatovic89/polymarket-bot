"""Deterministic differential cases for behavior absent from the original prototype."""
import itertools
import json
import random
from pathlib import Path

MARKET='0x'+'1'*64
BASE={'market':MARKET,'upId':'1','downId':'2','startingCapital':500,'outcome':'UP','seed':7}
BOOK={'bids':[[.38,40],[.37,100]],'asks':[[.4,40],[.41,100]]}
CASES=[]

def order(cid='a',side='BUY',price=.45,size=10,kind='FOK',asset='1',**extra):
    return dict(kind='place_limit',clientOrderId=cid,assetId=asset,side=side,price=price,size=size,orderType=kind,**extra)

def step(now=1000,**extra):
    return dict(nowMs=now,**extra)

def case(name,steps,**extra):
    CASES.append(dict(BASE,name=name,steps=steps,**extra))

for side,kind in itertools.product(['BUY','SELL'],['FOK','GTC','GTD']):
    for size in [10,60,200]:
        expiry={'expireAtMs':62000} if kind=='GTD' else {}
        prefix=[step(up=BOOK,down=BOOK,intents=[{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':250}])]
        trade=order(side=side,kind=kind,size=size,price=.5 if side=='BUY' else .3,meta={'scenario':'diagnostics'},**expiry)
        case(f'{side}-{kind}-{size}',prefix+[step(2000,intents=[trade]),step(63000,up=BOOK,down=BOOK)])

for side,kind,price in itertools.product(['BUY','SELL'],['FOK','GTC','GTD'],[.35,.4,.45]):
    expiry={'expireAtMs':62000} if kind=='GTD' else {}
    case(f'post-only-{side}-{kind}-{price}',[step(up=BOOK,down=BOOK,intents=[order(side=side,kind=kind,price=price,postOnly=True,**expiry)])])

for mode in ['worst_queue','touch_or_better']:
    for side in ['BUY','SELL']:
        price=.39 if side=='BUY' else .39
        for next_price in [.38,.39,.4]:
            next_book={'bids':[[next_price,500]],'asks':[[next_price,500]]}
            case(f'maker-{mode}-{side}-{next_price}',[step(up=BOOK,down=BOOK,intents=[order(side=side,kind='GTC',price=price,size=200)]),step(2000,up=next_book)],makerFillMode=mode)

for cancel in ['cancel_order','cancel_batch','cancel_market','cancel_all']:
    intent={'kind':cancel}
    if cancel=='cancel_order':intent['clientOrderId']='a'
    if cancel=='cancel_batch':intent['orders']=[{'clientOrderId':'a'},{'clientOrderId':'a'},{'orderId':'external'}]
    if cancel=='cancel_market':intent.update(market=MARKET,assetId='1')
    for delay in [0,500]:
        case(f'{cancel}-delay-{delay}',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2,size=100)]),step(1600,intents=[intent]),step(2200),step(3000,intents=[order(kind='GTC',price=.2,size=10)])],latencyMs=delay)

case('cancel-latency-scope-includes-new-orders',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2)]),step(1600,intents=[{'kind':'cancel_market','market':MARKET}]),step(1700,intents=[order('b',kind='GTC',price=.2)]),step(2400)],latencyMs=500)
case('place-and-cancel-same-list',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2),{'kind':'cancel_batch','orders':[{'clientOrderId':'a'}]}])])
case('references-and-scopes',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2),order('b',kind='GTC',price=.2)]),step(2000,intents=[{'kind':'cancel_batch','orders':[None,{}, {'clientOrderId':' missing '},{'clientOrderId':'missing'},{'clientOrderId':'b','orderId':'bt-0-a'},{'clientOrderId':'a','orderId':'wrong'},{'orderId':'external'},{'clientOrderId':'a'}]},{'kind':'cancel_market'},{'kind':'cancel_market','market':'wrong'},{'kind':'cancel_market','assetId':'bad'}])])
case('missing-exchange-id',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2),{'kind':'cancel_batch','orders':[{'clientOrderId':'a'}]}]),step(2000)],latencyMs=500)
case('cancel-false',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2)]),step(1600,intents=[{'kind':'cancel_all'}])],latencyMs=500,cancelLatency=False)
case('stale-synthetic-partial-remainder',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.4,size=100)]),step(1400,tick=False),step(2000,up={'bids':[[.39,100]],'asks':[[.45,100]]})])
case('synthetic-expiry',[step(up=BOOK,down=BOOK,intents=[order(kind='GTD',price=.2,expireAtMs=62000)]),step(63000,tick=False),step(64000)])
case('queued-synthetic',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2)]),step(1400,tick=False),step(2000)],mode='queued')
case('synthetic-can-take',[step(up=BOOK,down=BOOK),step(1400,tick=False,intents=[order()])])
case('jitter-ordering',[step(up=BOOK,down=BOOK,intents=[order(str(i),kind='GTC',price=.2) for i in range(10)]),step(1300),step(1700)],latencyMs=300,jitterMs=250)
case('funding-batch',[step(up=BOOK,down=BOOK,intents=[{'kind':'place_batch','orders':[order(str(i),size=800) for i in range(3)]}])])
case('funding-separate',[step(up=BOOK,down=BOOK,intents=[order(str(i),size=800) for i in range(3)])])
case('pending-capital-callback',[step(up=BOOK,down=BOOK,intents=[order('a',size=800),order('b',size=800)],callbacks={'order_submitted':[order('c',size=800)]})])
case('pending-split-merge-callback',[step(up=BOOK,down=BOOK,intents=[{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':300},{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':300}],callbacks={'positions_split':[{'kind':'merge_positions','assetIdA':'1','assetIdB':'2','size':300},{'kind':'merge_positions','assetIdA':'1','assetIdB':'2','size':300}]})])
case('split-merge-failure-idempotency',[step(up=BOOK,down=BOOK,intents=[{'kind':'split_positions','assetIdA':'1','assetIdB':'1','size':10},{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':0},{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':600},{'kind':'merge_positions','assetIdA':'1','assetIdB':'2','size':10},{'kind':'merge_positions','assetIdA':'1','assetIdB':'1','size':10}]),step(2000,intents=[{'kind':'split_positions','assetIdA':'1','assetIdB':'2','size':100}]*2),step(3000,intents=[{'kind':'merge_positions','assetIdA':'1','assetIdB':'2','size':300}]*2)])
for bad in [dict(price=0),dict(size=0),dict(asset=''),dict(size=2001),dict(kind='GTD'),dict(kind='GTD',expireAtMs=2000),dict(kind='GTD',expireAtMs=None)]:
    case('validation-'+str(bad),[step(up=BOOK,down=BOOK,intents=[order(**bad)])])
case('risk-open-order-limit',[step(up=BOOK,down=BOOK,intents=[order(str(i),kind='GTC',price=.1,size=1) for i in range(105)])])
case('risk-position-exposure',[step(up=BOOK,down=BOOK,intents=[order('a',kind='GTC',price=.1,size=1200),order('b',kind='GTC',price=.1,size=1200),order('c',side='SELL',kind='GTC',price=.9,size=2000)])])
case('duplicate-retry',[step(up=BOOK,down=BOOK,intents=[order(kind='GTC',price=.2)]),step(2000,intents=[order(kind='GTC',price=.2),order(size=3000)])])

def submitted(cid='a',oid=None,now=1000):
    o=dict(clientOrderId=cid,market=MARKET,assetId='1',side='BUY',price=.5,size=10,remaining=10,filled=0,orderType='GTC',state='requested',createdAtMs=now,updatedAtMs=now,meta={'generation':now})
    if oid:o['orderId']=oid
    return dict(kind='order_submitted',tsMs=now,order=o)

def accepted(oid='old',now=1100):return dict(kind='order_accepted',tsMs=now,clientOrderId='a',orderId=oid)
def done(oid='old',now=1400,reason='canceled',**extra):return dict(kind='order_done',tsMs=now,clientOrderId='a',orderId=oid,reason=reason,**extra)
def fill(oid='old',now=1200,cid='a',id='f',size=4,side='BUY',price=.5):
    f=dict(id=id,tsMs=now,market=MARKET,assetId='1',side=side,price=price,size=size,orderId=oid,liquidity='TAKER',feeRateBps=700)
    if cid:f['clientOrderId']=cid
    return dict(kind='fill',fill=f)
def ws(oid='old',now=1300,status='CANCELED',matched=4,event='CANCELLATION'):
    return dict(kind='ws_order_update',tsMs=now,order=dict(orderId=oid,assetId='1',side='BUY',price=.5,originalSize=10,sizeMatched=matched,status=status,orderType='GTC',event=event))

for perm in itertools.permutations([accepted(),fill(),ws(),done()]):
    case('out-of-order-'+','.join(e['kind'] for e in perm),[step(up=BOOK,down=BOOK,events=[submitted()]),*[step(2000+j,events=[e],tick=False) for j,e in enumerate(perm)]])
case('id-reuse-late-events',[step(up=BOOK,down=BOOK,events=[submitted(),accepted(),done()]),step(2000,events=[submitted(now=2000),accepted('new',2100),accepted('old',2200),done('old',2300),ws('old',2400),fill('old',2500),fill('new',2600,id='newf')])])
case('closed-replacement-late-ack',[step(up=BOOK,down=BOOK,events=[submitted(),accepted(),done(),submitted(now=2000),accepted('new',2100),done('new',2200),accepted('old',2300),fill('old',2400)])])
case('duplicate-fill-terminal-ws',[step(up=BOOK,down=BOOK,events=[submitted(),accepted(),fill(size=10),done(reason='filled'),ws(status='CONFIRMED',matched=10,event='UPDATE'),ws(status='MATCHED',matched=0,event='UPDATE'),fill(size=10)])])
case('external-fill-without-client',[step(up=BOOK,down=BOOK,events=[fill(cid=None),ws(status='OPEN',event='UPDATE'),submitted(oid='old'),accepted()])])
case('loss-stop',[step(up=BOOK,down=BOOK,events=[fill(size=2000),fill(id='loss',size=2000,side='SELL',price=.01)]),step(2000,intents=[order(),{'kind':'cancel_all'}])])
case('missing-books',[step(intents=[order()]),step(2000,up={'bids':[],'asks':[]},intents=[order('b',kind='GTC')]),step(3000,down=BOOK)])
case('depth-snapshot',[step(up={'bids':[[.4,1],[.4,2],[.3,0],[.2,4]],'asks':[[.5,3],[.6,4]]},down={'bids':[[.2,5]],'asks':[[.7,6],[.8,7]]})])

rng=random.Random(829137)
for idx in range(50):
    steps=[]
    for j in range(30):
        now=1000+j*1000
        book={'bids':[[round(rng.uniform(.1,.45),2),rng.randint(1,200)]], 'asks':[[round(rng.uniform(.5,.9),2),rng.randint(1,200)]]}
        intents=[]
        if rng.random()<.75:
            kind=rng.choice(['FOK','GTC','GTD']);expiry={'expireAtMs':now+60000} if kind=='GTD' else {}
            intents=[order(str(rng.randrange(8)),side=rng.choice(['BUY','SELL']),price=round(rng.uniform(.1,.9),2),size=rng.randint(5,250),kind=kind,asset=rng.choice(['1','2']),postOnly=rng.choice([True,False]),meta={'j':j},**expiry)]
        else:intents=[{'kind':'cancel_all'}]
        steps.append(step(now,up=book,down=book,intents=intents,tick=rng.random()>.15))
    case(f'seeded-interactions-{idx}',steps,latencyMs=rng.choice([0,500,1200]),jitterMs=200,mode=rng.choice(['immediate','queued']))

AGG=[]
for name,pnls in [('empty',[]),('flat',[0,0,0]),('streaks',[1,1,0,1,-2,-2,0,-3,0,0,0,4,4]),('degenerate',[1.1]*20),('tails',[rng.choice([-1,0,2]) for _ in range(1005)])]:
    markets=[]
    for i,pnl in enumerate(pnls):
        ts=1609372800000+i*86400000
        markets.append(dict(slug=f'm-{i}',marketId=MARKET,finalOutcome='UP',pnl=pnl,feesPaid=.125,tradeCount=int(pnl!=0 or i%3==0),tradeAsMaker=0,tradeAsTaker=1,skipReason='no_in_window_activity',marketStartMs=ts,execution=dict(durationMs=100+i%7,startedAtMs=i*50,finishedAtMs=i*50+100+i%7)))
    rng.shuffle(markets)
    AGG.append(dict(name=name,markets=markets,initialCapital=500))
fixed=[[v,p] for v in [0,-0.,.125,-.125,1.005,2.55,2.675,-.00001,149.23,-14.65,1e-9] for p in range(7)]
for _ in range(2000):fixed.append([rng.uniform(-10000,10000),rng.randrange(7)])
output=Path(__file__).parent/'fixtures/core-input.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(dict(cases=CASES,aggregations=AGG,fixed=fixed)))
print(f'{len(CASES)} behavioral cases; {len(AGG)} aggregations; {len(fixed)} decimal formatting cases: {output}')
