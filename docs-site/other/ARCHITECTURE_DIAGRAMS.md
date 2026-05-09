# Polymarket Trading Bot - Architecture Diagrams

## Component Architecture Diagram

```mermaid
graph TB
    subgraph "Data Collection Layer"
        WS_Market[Market WebSocket<br/>Polymarket WS]
        WS_User[User WebSocket<br/>Account Events]
        REST_API[REST API<br/>Account Polling]
        Gamma_API[Gamma API<br/>Market Resolution]
    end

    subgraph "CLI Entry Points"
        RecordLive[record-live.ts<br/>Data Recorder]
        TradingBot[trading-bot.ts<br/>Live Trading]
        Backtest[backtest.ts<br/>Backtesting]
    end

    subgraph "Market Data Processing"
        MarketDecoder[marketChannelDecoder<br/>JSON → Messages]
        MarketEngine[MarketEngine<br/>Orderbook State]
        OrderBookEngine[OrderBookEngine<br/>Per-Asset Books]
    end

    subgraph "Strategy Layer"
        StrategyRegistry[strategyRegistry<br/>Strategy Definitions]
        Strategy[Strategy Interface<br/>onMarketTick/onAccountEvent]
        StrategyRunner[StrategyRunner<br/>Orchestration]
    end

    subgraph "Order Management"
        OrderManager[OrderManager<br/>Lifecycle + Risk]
        RiskLimits[riskLimits<br/>Validation]
        Portfolio[Portfolio<br/>Positions + PnL]
    end

    subgraph "Execution Layer"
        LiveExec[LiveExecution<br/>Polymarket API]
        BacktestExec[BacktestExecution<br/>Simulated Fills]
        ClobClient[ClobClient<br/>Polymarket CLOB]
    end

    subgraph "Data Storage"
        ParquetWriter[Parquet Writer<br/>Event Storage]
        ParquetReader[Parquet Reader<br/>Event Replay]
        FileSystem[Parquet Files<br/>data/events/]
    end

    %% Data Collection Flow
    WS_Market --> RecordLive
    WS_Market --> TradingBot
    WS_User --> TradingBot
    REST_API --> TradingBot
    Gamma_API --> RecordLive
    Gamma_API --> TradingBot

    %% Recording Flow
    RecordLive --> MarketDecoder
    MarketDecoder --> ParquetWriter
    ParquetWriter --> FileSystem

    %% Live Trading Flow
    TradingBot --> MarketDecoder
    MarketDecoder --> MarketEngine
    MarketEngine --> StrategyRunner
    WS_User --> StrategyRunner
    REST_API --> StrategyRunner
    StrategyRunner --> Strategy
    Strategy --> OrderManager
    OrderManager --> RiskLimits
    OrderManager --> LiveExec
    LiveExec --> ClobClient
    StrategyRunner --> Portfolio
    OrderManager --> Portfolio

    %% Backtesting Flow
    Backtest --> ParquetReader
    ParquetReader --> FileSystem
    ParquetReader --> MarketDecoder
    MarketDecoder --> MarketEngine
    MarketEngine --> StrategyRunner
    StrategyRunner --> Strategy
    Strategy --> OrderManager
    OrderManager --> BacktestExec
    StrategyRunner --> Portfolio

    %% Strategy Registration
    StrategyRegistry --> Strategy

    %% Market Engine Internals
    MarketEngine --> OrderBookEngine

    style RecordLive fill:#e1f5ff
    style TradingBot fill:#e1f5ff
    style Backtest fill:#e1f5ff
    style Strategy fill:#fff4e1
    style MarketEngine fill:#e8f5e9
    style Portfolio fill:#fce4ec
```

## System Flow Diagram - Live Trading

```mermaid
flowchart TD
    Start([Start: trading-bot.ts]) --> LoadConfig[Load Config<br/>API Keys, URLs]
    LoadConfig --> ResolveMarket[Resolve Current Market<br/>Gamma API: Get 15m Up/Down Assets]

    ResolveMarket --> InitWS[Initialize WebSocket<br/>Market Channel]
    ResolveMarket --> InitUserWS[Initialize User WS<br/>Account Events]
    ResolveMarket --> InitPoller[Initialize REST Poller<br/>Account Fallback]

    InitWS --> ConnectWS[Connect Market WS<br/>Subscribe to Assets]
    InitUserWS --> ConnectUserWS[Connect User WS<br/>Authenticate]
    InitPoller --> StartPoller[Start Polling<br/>Disabled Initially]

    ConnectWS --> CreateEngine[Create MarketEngine<br/>Orderbook State]
    CreateEngine --> CreateStrategy[Load Strategy<br/>from Registry]
    CreateStrategy --> CreateRunner[Create StrategyRunner<br/>+ OrderManager + Portfolio]

    CreateRunner --> CreateExec[Create LiveExecution<br/>Polymarket CLOB Client]

    CreateExec --> StartBoundaryScheduler[Start 15m Boundary Scheduler<br/>Auto-Rotate Markets]

    StartBoundaryScheduler --> EventLoop{Event Loop}

    EventLoop -->|Market WS Message| ParseJSON[Parse Raw JSON<br/>marketChannelDecoder]
    ParseJSON --> DecodeMsg[Decode Message<br/>book/price_change/etc]
    DecodeMsg --> UpdateOrderbook[Update Orderbook<br/>MarketEngine.handleRaw]

    UpdateOrderbook -->|book/price_change| EmitTick[Emit Market Tick<br/>to StrategyRunner]

    EmitTick --> PreTick[Pre-Tick Processing<br/>OrderManager.onMarketTick]
    PreTick --> ExecuteQueued[Execute Queued Intents<br/>1-Tick Latency Queue]
    ExecuteQueued --> RiskCheck[Risk Limits Check<br/>enforceRiskLimits]
    RiskCheck --> PlaceOrders[Place Orders<br/>LiveExecution.placeLimit]
    PlaceOrders --> ClobAPI[CLOB API Call<br/>createOrder + postOrder]
    ClobAPI --> EmitEvents[Emit Account Events<br/>order_accepted/open]

    EmitEvents --> StrategyTick[Strategy.onMarketTick<br/>Portfolio Snapshot]
    StrategyTick --> GenerateIntents[Generate Intents<br/>place_limit/cancel_order]
    GenerateIntents --> QueueIntents[Queue Intents<br/>OrderManager.handleIntents]

    EventLoop -->|User WS Message| ParseUserEvent[Parse User Event<br/>trade/order messages]
    ParseUserEvent --> EmitFill[Emit Fill Event<br/>AccountEvent.fill]
    EmitFill --> StrategyAccount[Strategy.onAccountEvent<br/>Portfolio Snapshot]
    StrategyAccount --> UpdatePortfolio[Update Portfolio<br/>Positions + PnL]
    UpdatePortfolio --> CascadeIntents[Cascade Intents<br/>Max Depth: 25]
    CascadeIntents --> QueueIntents

    EventLoop -->|REST Poll Response| ParsePollEvent[Parse Poll Event<br/>Open Orders + Fills]
    ParsePollEvent --> EmitAccountEvents[Emit Account Events<br/>order_open/fill]
    EmitAccountEvents --> StrategyAccount

    EventLoop -->|15m Boundary| RotateMarket[Rotate Market<br/>Close WS + Reconnect]
    RotateMarket --> ResolveMarket

    EventLoop -->|Shutdown Signal| Cleanup[Cleanup<br/>Close Connections]
    Cleanup --> End([End])

    style Start fill:#e1f5ff
    style EventLoop fill:#fff4e1
    style StrategyTick fill:#e8f5e9
    style ClobAPI fill:#fce4ec
    style UpdatePortfolio fill:#e8f5e9
```

## `trading-bot.ts` Runtime Flow (Focused)

### Startup + steady-state loops (Market WS + Account WS + optional REST poll fallback)

```mermaid
sequenceDiagram
    autonumber
    participant CLI as trading-bot.ts (CLI)
    participant CFG as loadPolymarketConfigFromEnv
    participant BAL as logBalanceAndApproval (rpc)
    participant GAM as resolveCurrentUpDown15mAssets (Gamma)
    participant MWS as Market WS (createLiveMarketEventSource)
    participant UWS as User WS (createUserWsAccountSource)
    participant POLL as REST Poll (createRestPollAccountSource)
    participant ENG as MarketEngine
    participant RUN as StrategyRunner
    participant OM as OrderManager
    participant STR as Strategy
    participant PF as Portfolio

    CLI->>CFG: Load config (urls, creds, privateKey)
    CLI->>BAL: Check balance + allowance (USDC + ERC1155 approvals)
    CLI->>GAM: Resolve current 15m market assetsIds + slug
    CLI->>ENG: Construct MarketEngine(onTick → runner.onMarketTick)
    CLI->>OM: Construct OrderManager(execution = LiveExecution)
    CLI->>RUN: Construct StrategyRunner(strategy, orderManager, portfolio)
    CLI->>MWS: start() subscribe MARKET assets_ids
    CLI->>UWS: start() subscribe USER (auth + optional markets filter)
    CLI->>POLL: start() but disabled initially

    Note over UWS,POLL: Fallback policy\n- if user WS disconnects after stable period → enable poller\n- if user WS is stably connected → disable poller

    loop Market WS messages
        MWS-->>ENG: raw_json (book/price_change/...)
        ENG-->>RUN: onMarketTick(tick, portfolio.snapshot)
        RUN->>OM: onMarketTick() executes queued intents (1-tick latency)
        RUN->>STR: strategy.onMarketTick(tick, portfolio.snapshot)
        STR-->>RUN: intents (place_limit/cancel/...)
        RUN->>OM: handleIntents(intents) (queued for next tick)
    end

    loop Account events (User WS or REST poll)
        UWS-->>RUN: AccountEvent(s) (fill/order/ws_order_update/status)
        RUN->>PF: portfolio.apply(ev)
        RUN->>STR: strategy.onAccountEvent(ev, portfolio.snapshot, lastMarket)
        STR-->>RUN: follow-up intents (optional)
        RUN->>OM: handleIntents(intents)
    end
```

### Order lifecycle + portfolio updates (fast fills + out-of-order handling)

```mermaid
sequenceDiagram
    autonumber
    participant STR as Strategy
    participant RUN as StrategyRunner
    participant OM as OrderManager
    participant EX as LiveExecution (CLOB client)
    participant UWS as User WS
    participant PF as Portfolio

    Note over PF: Portfolio tracks:\n- bot open orders by clientOrderId\n- ws open orders by orderId (ws_order_update)\n- fill idempotency (seenFillIds)\n- out-of-order fill buffering by orderId (pendingFilledByOrderId)

    STR-->>RUN: Intent: place_limit(clientOrderId, price, size, tif)
    RUN->>OM: handleIntents() (queued)

    Note over OM: 1-tick latency\nintents execute on next Market tick

    OM->>PF: AccountEvent.order_submitted (requested)
    OM->>EX: createOrder + postOrder

    par Exchange/WS can publish before local execution returns
        UWS-->>RUN: AccountEvent.fill (MATCHED/MINED/CONFIRMED depending config)
        RUN->>PF: apply(fill)
        Note over PF: If fill arrives before orderId↔clientOrderId mapping,\nbuffer size by orderId and apply once mapping exists.
    and Local execution returns
        EX-->>OM: postOrder response (orderID)
        OM-->>RUN: AccountEvent.order_accepted(clientOrderId, orderId)
        RUN->>PF: apply(order_accepted) → index orderId↔clientOrderId → apply pending fills
    end

    UWS-->>RUN: AccountEvent.ws_order_update (PLACEMENT/UPDATE/CANCELLATION)
    RUN->>PF: update wsOpenOrdersByOrderId

    UWS-->>RUN: AccountEvent.order_done(orderId, reason=filled/canceled)
    RUN->>PF: remove from open order tracking (bot + ws)
```

### What updates balances/positions?

```mermaid
flowchart LR
    subgraph "Portfolio state"
      POS[positionsByAssetId]
      ORD[openOrdersByClientId]
      WSORD[wsOpenOrdersByOrderId]
      PNL[realizedPnlTotal]
    end

    FILL[AccountEvent.fill] -->|BUY/SELL| POS
    FILL -->|filled/remaining update by orderId/clientOrderId| ORD
    DONE[AccountEvent.order_done] -->|remove| ORD
    WSUPD[AccountEvent.ws_order_update] -->|track all account open orders| WSORD
    FILL -->|SELL realizes pnl vs avg entry| PNL
```

## System Flow Diagram - Backtesting

```mermaid
flowchart TD
    Start([Start: backtest.ts]) --> ParseArgs[Parse CLI Args<br/>Parquet Files + Strategy]
    ParseArgs --> LoadStrategy[Load Strategy<br/>from Registry]
    LoadStrategy --> CreateRunner[Create StrategyRunner<br/>+ OrderManager + Portfolio]
    CreateRunner --> CreateBacktestExec[Create BacktestExecution<br/>Simulated Order Matching]

    CreateBacktestExec --> OpenParquet[Open Parquet Files<br/>Multiple Files Supported]
    OpenParquet --> CreateHeap[Create Min-Heap<br/>Merge by ingest_seq]

    CreateHeap --> ReplayLoop{Replay Loop<br/>Tick-by-Tick}

    ReplayLoop -->|Next Event| PopHeap[Pop from Heap<br/>Smallest ingest_seq]
    PopHeap --> ParseRow[Parse Parquet Row<br/>raw_json + timestamps]
    ParseRow --> DecodeMsg[Decode Message<br/>marketChannelDecoder]

    DecodeMsg --> UpdateOrderbook[Update Orderbook<br/>MarketEngine.handleRaw]
    UpdateOrderbook -->|book/price_change| EmitTick[Emit Market Tick<br/>to StrategyRunner]

    EmitTick --> PreTick[Pre-Tick Processing<br/>OrderManager.onMarketTick]
    PreTick --> ExecuteQueued[Execute Queued Intents<br/>1-Tick Latency Queue]
    ExecuteQueued --> RiskCheck[Risk Limits Check<br/>enforceRiskLimits]
    RiskCheck --> SimPlaceOrder[Simulate Order Placement<br/>BacktestExecution.placeLimit]

    SimPlaceOrder -->|FOK| ImmediateFill[Immediate Fill<br/>Match Against Book]
    SimPlaceOrder -->|GTC/GTD| RestOrder[Rest Order<br/>Track in openByClientId]

    ImmediateFill --> EmitFill[Emit Fill Events<br/>AccountEvent.fill]
    RestOrder --> CheckMakerFill[Check Maker Fill<br/>onMarketTick: Touch Cross]
    CheckMakerFill -->|Crossed| EmitFill
    CheckMakerFill -->|Not Crossed| ContinueReplay

    EmitFill --> StrategyTick[Strategy.onMarketTick<br/>Portfolio Snapshot]
    StrategyTick --> GenerateIntents[Generate Intents<br/>place_limit/cancel_order]
    GenerateIntents --> QueueIntents[Queue Intents<br/>OrderManager.handleIntents]

    EmitFill --> UpdatePortfolio[Update Portfolio<br/>Positions + PnL]
    UpdatePortfolio --> CascadeIntents[Cascade Intents<br/>Max Depth: 25]
    CascadeIntents --> QueueIntents

    ReplayLoop -->|File Complete| NextFile{More Files?}
    NextFile -->|Yes| ReplayLoop
    NextFile -->|No| SettleMarket[Settle Market Episode<br/>Merge + Redeem Positions]

    SettleMarket --> ComputeMerge[Compute Merge Opportunities<br/>Paired YES/NO Positions]
    ComputeMerge --> SyntheticMerge[Synthetic Merge Fills<br/>Sell at 1.0 + 0.0]
    SyntheticMerge --> InferWinner[Infer Winner Asset<br/>Best Bid Comparison]
    InferWinner --> SyntheticRedeem[Synthetic Redeem Fills<br/>Winner: 1.0, Loser: 0.0]

    SyntheticRedeem --> UpdatePortfolio
    UpdatePortfolio --> CalculateMetrics[Calculate Metrics<br/>PnL, Win Rate, etc]

    CalculateMetrics --> PrintResults[Print Results<br/>Per-Market + Summary]
    PrintResults --> End([End])

    ContinueReplay --> ReplayLoop

    style Start fill:#e1f5ff
    style ReplayLoop fill:#fff4e1
    style StrategyTick fill:#e8f5e9
    style SimPlaceOrder fill:#fce4ec
    style UpdatePortfolio fill:#e8f5e9
    style SettleMarket fill:#fff9c4
```

## System Flow Diagram - Data Recording

```mermaid
flowchart TD
    Start([Start: record-live.ts]) --> LoadConfig[Load Config<br/>WS URL, API Keys]
    LoadConfig --> InitRecorder[Initialize Parquet Recorder<br/>RotatingParquetEventRecorder]
    InitRecorder --> ResolveMarket[Resolve Current Market<br/>Gamma API: Get 15m Up/Down]

    ResolveMarket --> CheckAge{Market Age<br/>< 10s?}
    CheckAge -->|Too Old| WaitBoundary[Wait for Next<br/>15m Boundary]
    CheckAge -->|OK| ConnectWS[Connect Market WS<br/>Subscribe to Assets]

    WaitBoundary --> ResolveMarket

    ConnectWS --> StartBoundaryScheduler[Start 15m Boundary Scheduler<br/>Auto-Rotate]
    StartBoundaryScheduler --> EventLoop{Event Loop}

    EventLoop -->|WS Message| IndexEvent[Index Event<br/>RawEventIndexer]
    IndexEvent --> ExtractFields[Extract Fields<br/>market/event_type/timestamp]

    ExtractFields --> CheckValid{Valid Market?}
    CheckValid -->|No| DropEvent[Drop Event<br/>Increment Counter]
    CheckValid -->|Yes| IncrementSeq[Increment ingest_seq<br/>Per-Market Counter]

    IncrementSeq --> BuildRow[Build Parquet Row<br/>ingest_seq + timestamps + raw_json]
    BuildRow --> CheckLag{Writer Lag<br/>< Max Inflight?}

    CheckLag -->|Too Much| DisconnectWS[Disconnect WS<br/>Prevent Memory Growth]
    CheckLag -->|OK| AppendParquet[Append to Parquet<br/>Async Write]

    DisconnectWS --> Reconnect[Reconnect After Delay<br/>1s]
    Reconnect --> ConnectWS

    AppendParquet --> TrackInflight[Track In-Flight<br/>Appends Counter]
    TrackInflight --> EventLoop

    EventLoop -->|WS Disconnect| ClassifyClose[Classify Close<br/>Expected vs Unexpected]
    ClassifyClose -->|Expected| ContinueLoop[Continue<br/>Normal Market End]
    ClassifyClose -->|Unexpected| WriteDisconnect[Write Disconnect Marker<br/>Synthetic Event]

    WriteDisconnect --> AppendParquet

    EventLoop -->|15m Boundary| Rotate[Rotate Market<br/>Close Writers]
    Rotate --> WaitDrain[Wait for In-Flight<br/>Appends to Drain]
    WaitDrain --> CloseWriters[Close Parquet Writers<br/>Write Footer + Rename]
    CloseWriters --> ResolveMarket

    EventLoop -->|Shutdown Signal| Shutdown[Shutdown<br/>Close All Writers]
    Shutdown --> RenameTerminated[Rename Files<br/>-terminated.parquet]
    RenameTerminated --> End([End])

    style Start fill:#e1f5ff
    style EventLoop fill:#fff4e1
    style AppendParquet fill:#e8f5e9
    style Rotate fill:#fff9c4
```

## Key Architectural Principles

### 1. **Shared Core Logic**

- `MarketEngine` and `StrategyRunner` are identical for live trading and backtesting
- Ensures strategy behavior matches exactly between modes
- Orderbook reconstruction uses the same decoder and engine

### 2. **Execution Abstraction**

- `ExecutionAdapter` interface abstracts live vs simulated execution
- `LiveExecution` calls Polymarket CLOB API
- `BacktestExecution` simulates fills against orderbook snapshots
- `OrderManager` works with either adapter transparently

### 3. **Event-Driven Architecture**

- Market ticks trigger strategy evaluation
- Account events (fills, order updates) cascade through strategy
- Portfolio updates are deterministic and event-sourced

### 4. **1-Tick Latency Queue**

- Intents generated on tick N execute on tick N+1
- Prevents feedback loops and ensures deterministic behavior
- Critical for backtest reproducibility

### 5. **Portfolio State Management**

- `Portfolio` tracks positions, orders, and realized PnL
- State updates are deterministic based on account events
- Closed positions are removed to keep state bounded

### 6. **Market Rotation**

- 15-minute windows align with Polymarket's Up/Down markets
- Automatic rotation at window boundaries
- Fresh state for each market episode

### 7. **Data Recording**

- Raw JSON events stored in Parquet format
- Per-market ingestion sequence numbers for ordering
- Synthetic disconnect markers for data gap detection

### 8. **Risk Management**

- `riskLimits` enforces position and order size limits
- Applied before order execution
- Prevents over-leveraging and invalid orders
