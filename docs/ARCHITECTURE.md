# Polymarket Trading Bot Architecture

## System Architecture Diagram

```mermaid
graph TB
    subgraph "CLI Entry Points"
        TradingBot[ trading-bot.ts<br/>Live Trading ]
        Backtest[ backtest.ts<br/>Backtesting ]
        RecordLive[ record-live.ts<br/>Data Recording ]
    end

    subgraph "Data Sources Layer"
        LiveWS[ liveMarketEventSource<br/>WebSocket Client ]
        ParquetReplay[ ParquetReader ]
        UserWS[ userWsAccountSource<br/>Account Events WS ]
        RestPoll[ restPollAccountSource<br/>REST Polling Fallback ]
        GammaAPI[ resolveUpDown15mAssets<br/>Gamma API Client ]
    end

    subgraph "Market Processing Layer"
        MarketEngine[ MarketEngine<br/>Orchestrator ]
        Decoder[ marketChannelDecoder<br/>JSON Parser ]
        OrderBookEngine[ MarketOrderBookEngine<br/>Multi-Asset Orderbook ]
        SingleBook[ OrderBookEngine<br/>Per-Asset Orderbook ]
    end

    subgraph "Strategy Layer"
        StrategyRunner[ StrategyRunner<br/>Orchestrator ]
        Strategy[ Strategy Interface<br/>onMarketTick/onAccountEvent ]
        StrategyRegistry[ strategyRegistry<br/>Strategy Factory ]
    end

    subgraph "Order Management Layer"
        OrderManager[ OrderManager<br/>Intent Queue & Validation ]
        RiskLimits[ riskLimits<br/>Risk Enforcement ]
    end

    subgraph "Execution Layer"
        LiveExec[ LiveExecution<br/>Polymarket CLOB API ]
        BacktestExec[ BacktestExecution<br/>Simulated Execution ]
    end

    subgraph "Portfolio Layer"
        Portfolio[ Portfolio<br/>State Management ]
        PortfolioMetrics[ portfolioMetrics<br/>PnL Calculation ]
    end

    subgraph "Data Storage"
        ParquetWriter[ RotatingParquetEventRecorder<br/>Parquet File Writer ]
        ParquetFiles[ Parquet Files<br/>data/events/ ]
    end

    subgraph "External Services"
        PolyWS[ Polymarket WebSocket<br/>Market Data ]
        PolyREST[ Polymarket REST API<br/>Order Execution ]
        Gamma[ Gamma API<br/>Market Resolution ]
    end

    %% CLI to Data Sources
    TradingBot --> LiveWS
    TradingBot --> UserWS
    TradingBot --> RestPoll
    TradingBot --> GammaAPI
    Backtest --> ParquetReplay
    RecordLive --> LiveWS
    RecordLive --> GammaAPI

    %% Data Sources to Market Processing
    LiveWS --> MarketHandler
    ParquetReplay --> MarketHandler
    MarketHandler --> Decoder
    Decoder --> MarketEngine
    MarketEngine --> OrderBookEngine
    OrderBookEngine --> SingleBook

    %% Market Processing to Strategy
    MarketEngine --> StrategyRunner
    StrategyRunner --> Strategy
    Strategy --> StrategyRegistry

    %% Strategy to Order Management
    StrategyRunner --> OrderManager
    OrderManager --> RiskLimits

    %% Order Management to Execution
    OrderManager --> LiveExec
    OrderManager --> BacktestExec

    %% Execution to Portfolio
    LiveExec --> Portfolio
    BacktestExec --> Portfolio
    UserWS --> Portfolio
    RestPoll --> Portfolio

    %% Portfolio to Strategy
    Portfolio --> StrategyRunner

    %% Data Storage
    RecordLive --> ParquetWriter
    ParquetWriter --> ParquetFiles
    ParquetFiles --> ParquetReplay

    %% External Services
    LiveWS --> PolyWS
    UserWS --> PolyWS
    LiveExec --> PolyREST
    GammaAPI --> Gamma

    style TradingBot fill:#e1f5ff
    style Backtest fill:#fff4e1
    style RecordLive fill:#e8f5e9
    style MarketEngine fill:#f3e5f5
    style StrategyRunner fill:#fff9c4
    style OrderManager fill:#fce4ec
    style Portfolio fill:#e0f2f1
```

## System Flow Diagram

```mermaid
flowchart TD
    Start([Start]) --> Mode{Mode?}

    Mode -->|Live Trading| LiveMode[Initialize Live Trading]
    Mode -->|Backtesting| BacktestMode[Initialize Backtesting]
    Mode -->|Recording| RecordMode[Initialize Recording]

    %% Live Trading Flow
    LiveMode --> ResolveAssets1[Resolve Current Market<br/>via Gamma API]
    ResolveAssets1 --> ConnectWS1[Connect to Polymarket WS<br/>Subscribe to Assets]
    ConnectWS1 --> ReceiveEvents1[Receive Raw JSON Events]
    ReceiveEvents1 --> ParseEvents1[Parse & Validate Events]
    ParseEvents1 --> UpdateOrderBook1[Update OrderBook State]
    UpdateOrderBook1 --> Tick1{Book or<br/>Price Change?}
    Tick1 -->|Yes| StrategyTick1[Strategy.onMarketTick]
    Tick1 -->|No| ReceiveEvents1

    StrategyTick1 --> ProcessIntents1[OrderManager.handleIntents<br/>Queue Intents]
    ProcessIntents1 --> NextTick1[Next Market Tick]
    NextTick1 --> ExecuteIntents1[OrderManager.onMarketTick<br/>Execute Queued Intents]
    ExecuteIntents1 --> RiskCheck1[Risk Limits Check]
    RiskCheck1 --> LiveExec1[LiveExecution.placeLimit<br/>Call Polymarket API]
    LiveExec1 --> OrderEvents1[Emit Account Events<br/>order_accepted, order_open]
    OrderEvents1 --> PortfolioUpdate1[Portfolio.apply<br/>Update State]
    PortfolioUpdate1 --> AccountEvent1[Strategy.onAccountEvent<br/>React to Fills/Status]

    AccountEvent1 --> UserWS1[User WS Receives Fills]
    UserWS1 --> FillEvents1[Emit Fill Events]
    FillEvents1 --> PortfolioUpdate1

    AccountEvent1 --> NextTick1
    NextTick1 --> ReceiveEvents1

    %% Backtesting Flow
    BacktestMode --> LoadParquet[Load Parquet Files<br/>Heap-Merge by ingest_seq]
    LoadParquet --> ReadRow[Read Next Row<br/>from Heap]
    ReadRow --> ParseRow[Parse Row JSON]
    ParseRow --> UpdateOrderBook2[Update OrderBook State]
    UpdateOrderBook2 --> Tick2{Book or<br/>Price Change?}
    Tick2 -->|Yes| StrategyTick2[Strategy.onMarketTick]
    Tick2 -->|No| ReadRow

    StrategyTick2 --> ProcessIntents2[OrderManager.handleIntents<br/>Queue Intents]
    ProcessIntents2 --> NextTick2[Next Market Tick]
    NextTick2 --> ExecuteIntents2[OrderManager.onMarketTick<br/>Execute Queued Intents]
    ExecuteIntents2 --> RiskCheck2[Risk Limits Check]
    RiskCheck2 --> BacktestExec1[BacktestExecution.placeLimit<br/>Simulate Against OrderBook]
    BacktestExec1 --> SimFills[Simulate Fills<br/>Match Against Book]
    SimFills --> OrderEvents2[Emit Account Events]
    OrderEvents2 --> PortfolioUpdate2[Portfolio.apply<br/>Update State]
    PortfolioUpdate2 --> AccountEvent2[Strategy.onAccountEvent]

    AccountEvent2 --> NextTick2
    NextTick2 --> MoreRows{More Rows?}
    MoreRows -->|Yes| ReadRow
    MoreRows -->|No| SettleMarket[Settle Market Episode<br/>Merge Pairs, Redeem Positions]
    SettleMarket --> CalcPnL[Calculate PnL Metrics]
    CalcPnL --> NextFile{More Files?}
    NextFile -->|Yes| LoadParquet
    NextFile -->|No| EndBacktest([End Backtest])

    %% Recording Flow
    RecordMode --> ResolveAssets2[Resolve Current Market<br/>via Gamma API]
    ResolveAssets2 --> ConnectWS2[Connect to Polymarket WS]
    ConnectWS2 --> ReceiveEvents2[Receive Raw JSON Events]
    ReceiveEvents2 --> ParseEvents2[Parse & Index Events]
    ParseEvents2 --> WriteParquet[Write to Parquet File<br/>Rotating by 15min Window]
    WriteParquet --> ReceiveEvents2

    WriteParquet --> Boundary{15min<br/>Boundary?}
    Boundary -->|Yes| RotateFile[Close Current File<br/>Open New File]
    RotateFile --> ResolveAssets2

    Boundary -->|No| ReceiveEvents2

    %% Common Components
    UpdateOrderBook1 -.-> OrderBook[OrderBook State<br/>Bids/Asks/Best Prices]
    UpdateOrderBook2 -.-> OrderBook
    PortfolioUpdate1 -.-> PortfolioState[Portfolio State<br/>Positions/Orders/Cash]
    PortfolioUpdate2 -.-> PortfolioState
    StrategyTick1 -.-> PortfolioState
    StrategyTick2 -.-> PortfolioState

    style LiveMode fill:#e1f5ff
    style BacktestMode fill:#fff4e1
    style RecordMode fill:#e8f5e9
    style StrategyTick1 fill:#fff9c4
    style StrategyTick2 fill:#fff9c4
    style PortfolioUpdate1 fill:#e0f2f1
    style PortfolioUpdate2 fill:#e0f2f1
```

## Architecture Overview

### Main Components

**1. CLI Entry Points**
- `trading-bot.ts`: Live trading bot that connects to Polymarket and executes strategies
- `backtest.ts`: Backtesting engine that replays recorded market data
- `record-live.ts`: Data recording tool that captures live market events to Parquet files

**2. Data Sources Layer**
- **Live Sources**: WebSocket connections to Polymarket for market data and account events
- **Replay Sources**: Parquet file readers for backtesting historical data
- **Market Resolution**: Gamma API integration to resolve current 15-minute Up/Down markets

**3. Market Processing Layer**
- **MarketEngine**: Central orchestrator that processes raw JSON events and maintains orderbook state
- **OrderBook Engines**: Hierarchical orderbook management (market-level → asset-level)
- **Event Handler**: Filters and validates incoming events before processing

**4. Strategy Layer**
- **Strategy Interface**: Defines `onMarketTick()` and `onAccountEvent()` hooks
- **StrategyRunner**: Orchestrates strategy execution, manages cascading events
- **Strategy Registry**: Factory pattern for creating strategy instances

**5. Order Management Layer**
- **OrderManager**: Queues intents, validates orders, enforces risk limits
- **Risk Limits**: Prevents over-leveraging and invalid order submissions

**6. Execution Layer**
- **LiveExecution**: Interfaces with Polymarket CLOB API for real trading
- **BacktestExecution**: Simulates order execution against historical orderbook state

**7. Portfolio Layer**
- **Portfolio**: Maintains positions, open orders, fills, and realized PnL
- **Portfolio Metrics**: Calculates merge opportunities and PnL metrics

**8. Data Storage**
- **Parquet Writer**: Rotating file writer that creates one file per 15-minute market episode
- **Parquet Files**: Persistent storage in `data/events/{symbol}/` directory

### Key Design Principles

1. **Shared Logic**: Both live trading and backtesting use the same `MarketEngine`, `StrategyRunner`, `OrderManager`, and `Portfolio` components
2. **Tick-by-Tick Accuracy**: Backtesting replays events in exact order (`ingest_seq`) to match live behavior
3. **Event-Driven Architecture**: Strategies react to market ticks and account events through cascading event handlers
4. **15-Minute Market Episodes**: System rotates markets every 15 minutes, aligning with Polymarket's Up/Down market structure
5. **Separation of Concerns**: Clear boundaries between data sources, market processing, strategy logic, and execution

### Data Flow Summary

**Live Trading:**
1. Resolve current market via Gamma API
2. Connect WebSocket and subscribe to assets
3. Receive raw JSON events → parse → update orderbook
4. On book/price_change ticks → strategy evaluates → generates intents
5. OrderManager queues intents → executes on next tick → calls LiveExecution
6. LiveExecution posts orders to Polymarket API
7. Fills arrive via User WebSocket → Portfolio updates → Strategy reacts

**Backtesting:**
1. Load Parquet files → heap-merge by `ingest_seq`
2. Replay events tick-by-tick → update orderbook
3. Strategy evaluates → generates intents
4. BacktestExecution simulates fills against orderbook
5. Portfolio updates → Strategy reacts
6. At market end → settle positions (merge pairs, redeem winners)
7. Calculate PnL metrics across all markets

**Recording:**
1. Resolve current market via Gamma API
2. Connect WebSocket and subscribe
3. Receive events → parse → write to Parquet file
4. Rotate file every 15 minutes at market boundary
5. Handle disconnects with synthetic markers

