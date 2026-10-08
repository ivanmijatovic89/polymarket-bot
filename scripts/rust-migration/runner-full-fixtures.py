"""Full original TS-body fixture inputs; native production bindings remain required."""
import copy,json

def tick(key='m',time=1,synthetic=False):return {'source':{'kind':'live','attempt':1},'msg':{'event_type':'binance_agg_trade' if synthetic else 'book'},'snapshot':{'market':key,'timestamp':time,'byAssetId':{}}}
def addtick(id,key='m',time=1,synthetic=False):return {'kind':'tick','id':id,'tick':tick(key,time,synthetic)}
def submit(id):return {'kind':'submitTick','id':id,'receipt':id}
def pump(turns=80):return {'kind':'pump','turns':turns}
def event(id,ev):return {'kind':'event','id':id,'event':ev}
def account(id):return {'kind':'submitAccount','id':id,'receipt':id}
def fill(fid='f',time=2,market='m'):return {'kind':'fill','fill':{'id':fid,'tsMs':time,'market':market,'assetId':'up','side':'BUY','price':.4,'size':2,'liquidity':'MAKER'}}
def order():return {'kind':'place_limit','clientOrderId':'fixture-a','assetId':'up','side':'BUY','price':.4,'size':2,'orderType':'GTC'}
def suborder():return {'kind':'order_submitted','tsMs':2,'order':{'clientOrderId':'a','orderId':'x','market':'a','assetId':'up','side':'BUY','price':.4,'size':2,'remaining':2,'filled':0,'state':'open','createdAtMs':2,'updatedAtMs':2}}
def fixtures():
 cases=[]
 def add(name,ops,**extra):cases.append({'name':name,'input':{'plugins':True,'operations':ops,**extra}})
 add('real-empty-decision',[addtick('a'),submit('a'),pump(),{'kind':'observe'}])
 add('synthetic-gated-plugin',[addtick('a',synthetic=True),submit('a'),pump()])
 add('synthetic-opted-plugin',[addtick('a',synthetic=True),submit('a'),pump()],pluginSynthetic=True)
 add('clock-zero-fallback',[addtick('a',time=0),submit('a'),pump()],nowMs=999)
 add('live-gated-decision-queued-tick-account-current-providers',[addtick('a'),addtick('b',time=2),event('e',fill()),submit('a'),pump(15),submit('b'),account('e'),{'kind':'mutateTick','id':'b','fields':{'timestamp':3}},{'kind':'providers','market':{'slug':'changed'},'balance':{'marker':1},'warmup':{'marker':2}},{'kind':'observe'},{'kind':'release','gate':'strategy'},pump(160),{'kind':'observe'}],marketPlans=[{'gate':'strategy'},{}])
 add('strategy-error-identity-and-funnel-recovery',[{'kind':'error','id':'same-error','message':'strategy rejected','name':'RangeError'},addtick('a'),addtick('b',time=2),submit('a'),submit('b'),pump(160)],marketPlans=[{'errorId':'same-error'},{}])
 add('capture-error-before-queue',[addtick('a'),submit('a'),pump()],captureErrorAt=0)
 add('late-start-block',[addtick('a',time=1001),submit('a'),pump(),addtick('b',time=1002),submit('b'),pump()],skipLateStartAfterMs=1000,market={'slug':'fixture','eventStartTime':'1970-01-01T00:00:00.000Z'})
 add('requires-new-player',[addtick('a','a'),submit('a'),pump(),addtick('b','b',2),submit('b'),pump()],createStrategy=False)
 add('rotate-clear-queued-intents',[addtick('a','a'),submit('a'),pump(),addtick('b','b',2),submit('b'),pump()],dryRun=True,marketPlans=[{'intents':[order()]},{}])
 add('immediate-order-lifecycle',[addtick('a'),submit('a'),pump()],dryRun=True,intentExecutionMode='immediate',marketPlans=[{'intents':[order()]}])
 add('queued-intents-only-real-book',[addtick('a'),submit('a'),pump(),addtick('b',time=2,synthetic=True),submit('b'),pump(),addtick('c',time=3),submit('c'),pump()],dryRun=True,marketPlans=[{'intents':[order()]},{},{}])
 add('execution-pre-fill-drained-before-market-decision',[addtick('a'),event('f',fill()),submit('a'),pump()],executionPlans=[{'eventIds':['f']}])
 add('fill-invalid-date-before-ledger',[addtick('a'),submit('a'),pump(),event('f',fill(time=1e308)),account('f'),pump()])
 add('rotation-cancels-old-orders-and-late-fill',[addtick('a','a'),submit('a'),pump(),event('s',suborder()),account('s'),pump(),addtick('b','b',3),submit('b'),pump(),event('f',fill(time=4,market='a')),account('f'),pump()],dryRun=True)
 add('real-callback-event-feedback-drain-boundary',[addtick('a'),event('f',fill()),submit('a'),pump()],executionPlans=[{'eventIds':['f']},{'eventIds':['f']}],accountPlans=[{'intents':[order()]}],intentExecutionMode='immediate',maxEventsPerDrain=1)
 add('invalid-starting-capital',[],startingCapital=-1)
 add('invalid-drain-boundary',[],maxEventsPerDrain=0)
 add('public-metadata-disabled-without-id',[{'kind':'strategyMeta'}],strategyParams={})
 add('public-metadata-empty-id-is-disabled',[{'kind':'strategyMeta'}],strategyId='',strategyParams={})
 add('public-metadata-fields-and-shared-params',[{'kind':'strategyMeta'},{'kind':'strategyMeta'},{'kind':'mutateParams','fields':{'after':2}},{'kind':'strategyMeta'}],strategyId='fixture-id',strategyParams={'before':1},plugins=True,requiredFeeds={'binanceWsSpotPrice':True},externalFeedsEnabled={'binanceWsSpotPrice':True})
 add('public-metadata-while-strategy-awaits',[addtick('a'),submit('a'),pump(),{'kind':'strategyMeta'},{'kind':'release','gate':'decision'},pump(),{'kind':'strategyMeta'}],strategyId='fixture-id',strategyParams={},marketPlans=[{'gate':'decision'}])
 add('current-falsy-plugin-snapshot-retains-earlier-truthy-account-cache',[addtick('a'),submit('a'),pump(),{'kind':'pluginCacheOverride','value':0},addtick('b',time=2),submit('b'),pump(),event('f',fill(time=3)),account('f'),pump(),{'kind':'observe'}])
 return cases
if __name__=='__main__':
 import argparse
 from pathlib import Path
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args()
 args.output.write_text(json.dumps(fixtures(),separators=(',',':'))+'\n')
