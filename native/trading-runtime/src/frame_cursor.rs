//! Historical frame admission. Synchronous callbacks consume all children in
//! one admission; deferred callbacks suspend the frame, including ready futures.
use crate::event_dispatch::{Completion, CompletionResolver, FutureDisposition, TickDisposition};
use crate::market::{decode_frame, MarketEngine, MarketError, MarketTick};
use crate::market_json::JsValue;
use crate::source::SourceHandle;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll};

/// Decoded messages have transferred ownership. No projection or reparsing is
/// performed; composite JavaScript identities survive capture and dispatch.
pub enum FrameMessages {
    Raw(String),
    Decoded(Vec<JsValue>),
}
pub struct FrameInput {
    pub messages: FrameMessages,
    pub source: SourceHandle,
    pub bootstrap: bool,
}
impl FrameInput {
    pub fn raw(raw: impl Into<String>, source: SourceHandle, bootstrap: bool) -> Self {
        Self {
            messages: FrameMessages::Raw(raw.into()),
            source,
            bootstrap,
        }
    }
    pub fn decoded(messages: Vec<JsValue>, source: SourceHandle, bootstrap: bool) -> Self {
        Self {
            messages: FrameMessages::Decoded(messages),
            source,
            bootstrap,
        }
    }
}
pub enum CursorStep {
    Tick(Rc<MarketTick>),
    Done(Option<JsValue>),
}
pub struct FrameCursor {
    messages: Vec<JsValue>,
    source: SourceHandle,
    bootstrap: bool,
    next: usize,
    done: bool,
}
impl FrameCursor {
    /// Called when admission starts, so queued raw JSON is decoded lazily.
    pub fn new(input: FrameInput) -> Result<Self, MarketError> {
        let messages = match input.messages {
            FrameMessages::Raw(raw) => decode_frame(&raw),
            FrameMessages::Decoded(messages) => messages,
        };
        Ok(Self {
            messages,
            source: input.source,
            bootstrap: input.bootstrap,
            next: 0,
            done: false,
        })
    }
    /// Metadata children apply without a strategy callback. Each yielded tick
    /// owns the immutable book history at this child, even after reset/advance.
    pub fn next(&mut self, engine: &mut MarketEngine) -> Result<CursorStep, MarketError> {
        if self.done {
            return Ok(CursorStep::Done(self.messages.last().cloned()));
        }
        while self.next < self.messages.len() {
            let index = self.next;
            self.next += 1;
            let result = engine.apply_frame_child(
                &self.messages[index],
                &self.source,
                self.bootstrap,
                index,
                self.messages.len(),
            );
            match result {
                Ok(Some(tick)) => return Ok(CursorStep::Tick(Rc::new(tick))),
                Ok(None) => {}
                Err(error) => {
                    self.done = true;
                    return Err(error);
                }
            }
        }
        self.done = true;
        Ok(CursorStep::Done(self.messages.last().cloned()))
    }
}
#[derive(Clone, Debug)]
pub enum FrameFailure<E> {
    Market(Arc<MarketError>),
    Callback(E),
}
pub type FrameReceipt<E> = Completion<Result<Option<JsValue>, FrameFailure<E>>>;
struct Queued<E> {
    input: FrameInput,
    resolver: CompletionResolver<Result<Option<JsValue>, FrameFailure<E>>>,
}
struct Active<E> {
    cursor: FrameCursor,
    resolver: CompletionResolver<Result<Option<JsValue>, FrameFailure<E>>>,
    waiting: Completion<Result<(), E>>,
}

/// Mirrors MarketEngine.pendingFrame. A direct throw rejects only that frame;
/// a deferred/queued failure rejects every already chained frame without apply.
/// Reset changes the books, never the admitted pending chain.
pub struct FrameAdmission<E> {
    engine: MarketEngine,
    active: Option<Active<E>>,
    queued: VecDeque<Queued<E>>,
    poisoned: Option<FrameFailure<E>>,
}
impl<E: Clone> FrameAdmission<E> {
    pub fn new(engine: MarketEngine) -> Self {
        Self {
            engine,
            active: None,
            queued: VecDeque::new(),
            poisoned: None,
        }
    }
    pub fn engine(&self) -> &MarketEngine {
        &self.engine
    }
    pub fn engine_mut(&mut self) -> &mut MarketEngine {
        &mut self.engine
    }
    pub fn is_pending(&self) -> bool {
        self.active.is_some() || !self.queued.is_empty()
    }
    pub fn submit<F>(&mut self, input: FrameInput, callback: &mut F) -> FrameReceipt<E>
    where
        F: FnMut(Rc<MarketTick>) -> Result<TickDisposition<E>, E>,
    {
        let (receipt, resolver) = Completion::pending();
        if self.is_pending() {
            self.queued.push_back(Queued { input, resolver });
        } else {
            self.begin(input, resolver, callback);
        }
        receipt
    }
    fn begin<F>(
        &mut self,
        input: FrameInput,
        resolver: CompletionResolver<Result<Option<JsValue>, FrameFailure<E>>>,
        callback: &mut F,
    ) where
        F: FnMut(Rc<MarketTick>) -> Result<TickDisposition<E>, E>,
    {
        match FrameCursor::new(input) {
            Ok(cursor) => self.drive(cursor, resolver, callback),
            Err(error) => {
                resolver.complete(Err(FrameFailure::Market(Arc::new(error))));
            }
        }
    }
    fn drive<F>(
        &mut self,
        mut cursor: FrameCursor,
        resolver: CompletionResolver<Result<Option<JsValue>, FrameFailure<E>>>,
        callback: &mut F,
    ) where
        F: FnMut(Rc<MarketTick>) -> Result<TickDisposition<E>, E>,
    {
        loop {
            match cursor.next(&mut self.engine) {
                Ok(CursorStep::Done(message)) => {
                    resolver.complete(Ok(message));
                    return;
                }
                Err(error) => {
                    resolver.complete(Err(FrameFailure::Market(Arc::new(error))));
                    return;
                }
                Ok(CursorStep::Tick(tick)) => match callback(tick) {
                    Ok(TickDisposition::Void) => {}
                    Ok(TickDisposition::Deferred(waiting)) => {
                        self.active = Some(Active {
                            cursor,
                            resolver,
                            waiting,
                        });
                        return;
                    }
                    Err(error) => {
                        resolver.complete(Err(FrameFailure::Callback(error)));
                        return;
                    }
                },
            }
        }
    }
    fn poison(&mut self, failure: FrameFailure<E>) {
        if !self.queued.is_empty() {
            self.poisoned = Some(failure);
        }
    }
    fn continuation(&self, cx: &Context<'_>) -> Poll<()> {
        if self.is_pending() {
            cx.waker().wake_by_ref();
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    }
    /// Poll at an owning-thread continuation boundary, never during submit.
    /// A newly returned Deferred always suspends, even if it is already ready.
    pub fn poll_ready<F>(&mut self, cx: &mut Context<'_>, callback: &mut F) -> Poll<()>
    where
        F: FnMut(Rc<MarketTick>) -> Result<TickDisposition<E>, E>,
    {
        if let Some(failure) = self.poisoned.take() {
            if let Some(queued) = self.queued.pop_front() {
                self.poison(failure.clone());
                queued.resolver.complete(Err(failure));
            }
            return self.continuation(cx);
        }
        if let Some(mut active) = self.active.take() {
            match Pin::new(&mut active.waiting).poll(cx) {
                Poll::Pending => {
                    self.active = Some(active);
                    return Poll::Pending;
                }
                Poll::Ready(Err(error)) => {
                    let failure = FrameFailure::Callback(error);
                    active.resolver.complete(Err(failure.clone()));
                    self.poison(failure);
                    return self.continuation(cx);
                }
                Poll::Ready(Ok(())) => {
                    let receipt = active.resolver.completion();
                    self.drive(active.cursor, active.resolver, callback);
                    if let Some(Err(failure)) = receipt.result() {
                        self.poison(failure);
                        return self.continuation(cx);
                    }
                    return self.continuation(cx);
                }
            }
        }
        if let Some(queued) = self.queued.pop_front() {
            let receipt = queued.resolver.completion();
            self.begin(queued.input, queued.resolver, callback);
            if let Some(Err(failure)) = receipt.result() {
                self.poison(failure);
            }
            return self.continuation(cx);
        }

        Poll::Ready(())
    }
}

type CallbackFuture<'a, E> = Pin<Box<dyn Future<Output = Result<(), E>> + 'a>>;
type PendingCallback<'a, E> = (CallbackFuture<'a, E>, CompletionResolver<Result<(), E>>);

/// Adapter for native async callers. Futures may retain session-local Rc graph
/// handles. The owning executor polls this adapter; receipts are awaitable.
pub struct FutureFrameAdmission<'a, E> {
    admission: FrameAdmission<E>,
    futures: VecDeque<PendingCallback<'a, E>>,
}
impl<'a, E: Clone> FutureFrameAdmission<'a, E> {
    pub fn new(engine: MarketEngine) -> Self {
        Self {
            admission: FrameAdmission::new(engine),
            futures: VecDeque::new(),
        }
    }
    pub fn engine(&self) -> &MarketEngine {
        self.admission.engine()
    }
    pub fn engine_mut(&mut self) -> &mut MarketEngine {
        self.admission.engine_mut()
    }
    pub fn is_pending(&self) -> bool {
        self.admission.is_pending()
    }
    pub fn submit<F>(&mut self, input: FrameInput, callback: &mut F) -> FrameReceipt<E>
    where
        F: FnMut(Rc<MarketTick>) -> Result<FutureDisposition<'a, E>, E>,
    {
        let futures = &mut self.futures;
        self.admission
            .submit(input, &mut |tick| adapt(callback(tick)?, futures))
    }
    /// Drive this owner with a standard Future. Live actor executors can use
    /// poll_ready directly alongside receipt/feed/strategy tasks.
    pub fn drain<'s, F>(
        &'s mut self,
        callback: &'s mut F,
    ) -> impl Future<Output = ()> + 's + use<'s, 'a, F, E>
    where
        F: FnMut(Rc<MarketTick>) -> Result<FutureDisposition<'a, E>, E> + 's,
    {
        std::future::poll_fn(move |cx| self.poll_ready(cx, callback))
    }
    pub fn poll_ready<F>(&mut self, cx: &mut Context<'_>, callback: &mut F) -> Poll<()>
    where
        F: FnMut(Rc<MarketTick>) -> Result<FutureDisposition<'a, E>, E>,
    {
        if let Some((mut future, resolver)) = self.futures.pop_front() {
            match future.as_mut().poll(cx) {
                Poll::Ready(result) => {
                    resolver.complete(result);
                }
                Poll::Pending => {
                    self.futures.push_front((future, resolver));
                    return Poll::Pending;
                }
            }
        }
        let futures = &mut self.futures;
        self.admission
            .poll_ready(cx, &mut |tick| adapt(callback(tick)?, futures))
    }
}
fn adapt<'a, E>(
    result: FutureDisposition<'a, E>,
    futures: &mut VecDeque<PendingCallback<'a, E>>,
) -> Result<TickDisposition<E>, E> {
    Ok(match result {
        FutureDisposition::Void => TickDisposition::Void,
        FutureDisposition::Deferred(future) => {
            let (completion, resolver) = Completion::pending();
            futures.push_back((future, resolver));
            TickDisposition::Deferred(completion)
        }
    })
}
