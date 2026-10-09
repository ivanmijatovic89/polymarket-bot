//! Session-local completion and FIFO strategy admission. No async runtime,
//! Send bound, message serialization, or hidden callback execution on submit.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

struct State<T> {
    result: Option<T>,
    wakers: Vec<Waker>,
}
pub struct Completion<T>(Rc<RefCell<State<T>>>);
pub struct CompletionResolver<T>(Rc<RefCell<State<T>>>);
impl<T> Clone for Completion<T> {
    fn clone(&self) -> Self {
        Self(Rc::clone(&self.0))
    }
}
impl<T> Completion<T> {
    pub fn pending() -> (Self, CompletionResolver<T>) {
        let state = Rc::new(RefCell::new(State {
            result: None,
            wakers: Vec::new(),
        }));
        (Self(Rc::clone(&state)), CompletionResolver(state))
    }
    pub fn ready(result: T) -> Self {
        let (completion, resolver) = Self::pending();
        resolver.complete(result);
        completion
    }
    pub fn is_ready(&self) -> bool {
        self.0.borrow().result.is_some()
    }
}
impl<T: Clone> Completion<T> {
    pub fn result(&self) -> Option<T> {
        self.0.borrow().result.clone()
    }
}
impl<T> CompletionResolver<T> {
    pub fn completion(&self) -> Completion<T> {
        Completion(Rc::clone(&self.0))
    }
    /// Promise-style first settlement wins. Dropping the resolver leaves the
    /// completion pending; it does not create an invented cancellation error.
    pub fn complete(&self, result: T) -> bool {
        let wakers = {
            let mut state = self.0.borrow_mut();
            if state.result.is_some() {
                return false;
            }
            state.result = Some(result);
            std::mem::take(&mut state.wakers)
        };
        for waker in wakers {
            waker.wake();
        }
        true
    }
}
impl<T: Clone> Future for Completion<T> {
    type Output = T;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut state = self.0.borrow_mut();
        if let Some(result) = &state.result {
            return Poll::Ready(result.clone());
        }
        if !state.wakers.iter().any(|waker| waker.will_wake(cx.waker())) {
            state.wakers.push(cx.waker().clone());
        }
        Poll::Pending
    }
}
pub enum TickDisposition<E> {
    Void,
    Deferred(Completion<Result<(), E>>),
}
pub enum FutureDisposition<'a, E> {
    Void,
    Deferred(Pin<Box<dyn Future<Output = Result<(), E>> + 'a>>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryLabel {
    Tick,
    Account,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BacklogWarning {
    pub depth: usize,
    pub entry: EntryLabel,
}
struct Entry<T, E> {
    label: EntryLabel,
    payload: T,
    resolver: CompletionResolver<Result<(), E>>,
}
struct Running<E> {
    label: EntryLabel,
    resolver: CompletionResolver<Result<(), E>>,
    completion: Completion<Result<(), E>>,
}
pub type DispatchReceipt<E> = Completion<Result<(), E>>;

/// Capture happens synchronously before queue admission. Processing starts at
/// a continuation boundary, reads providers then, and recovers after each error.
/// One FIFO carries market and account entries. No drop/backpressure policy is
/// added to the existing unbounded StrategyRunner funnel.
pub struct SerialDispatcher<T, E> {
    queue: VecDeque<Entry<T, E>>,
    running: Option<Running<E>>,
    settled: Option<Option<(EntryLabel, E)>>,
    depth: usize,
    warned_at: usize,
    warnings: Vec<BacklogWarning>,
    failures: Vec<(EntryLabel, E)>,
}
impl<T, E: Clone> Default for SerialDispatcher<T, E> {
    fn default() -> Self {
        Self::new()
    }
}
impl<T, E: Clone> SerialDispatcher<T, E> {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            running: None,
            settled: None,
            depth: 0,
            warned_at: 0,
            warnings: Vec::new(),
            failures: Vec::new(),
        }
    }
    pub fn depth(&self) -> usize {
        self.depth
    }
    pub fn take_warnings(&mut self) -> Vec<BacklogWarning> {
        std::mem::take(&mut self.warnings)
    }
    pub fn take_failures(&mut self) -> Vec<(EntryLabel, E)> {
        std::mem::take(&mut self.failures)
    }
    pub fn submit_tick<K, F>(&mut self, tick: K, capture: F) -> Result<DispatchReceipt<E>, E>
    where
        F: FnOnce(K) -> Result<T, E>,
    {
        Ok(self.enqueue(EntryLabel::Tick, capture(tick)?))
    }
    pub fn enqueue(&mut self, label: EntryLabel, payload: T) -> DispatchReceipt<E> {
        self.depth += 1;
        if self.depth >= 200 && self.depth >= self.warned_at.saturating_mul(2) {
            self.warned_at = self.depth;
            self.warnings.push(BacklogWarning {
                depth: self.depth,
                entry: label,
            });
        }
        let (receipt, resolver) = Completion::pending();
        self.queue.push_back(Entry {
            label,
            payload,
            resolver,
        });
        receipt
    }
    fn settle(
        &mut self,
        label: EntryLabel,
        resolver: CompletionResolver<Result<(), E>>,
        result: Result<(), E>,
    ) {
        let failure = result.as_ref().err().map(|error| (label, error.clone()));
        resolver.complete(result);
        // run resolves before the catch/finally tail. Frame continuations must
        // observe this settlement before the next serial entry can start.
        self.settled = Some(failure);
    }
    pub fn poll_ready<F>(&mut self, cx: &mut Context<'_>, process: &mut F) -> Poll<()>
    where
        F: FnMut(T) -> Result<TickDisposition<E>, E>,
    {
        if let Some(failure) = self.settled.take() {
            if let Some(failure) = failure {
                self.failures.push(failure);
            }
            self.depth -= 1;
            if self.depth == 0 {
                self.warned_at = 0;
            }
        }
        if let Some(mut running) = self.running.take() {
            match Pin::new(&mut running.completion).poll(cx) {
                Poll::Pending => {
                    self.running = Some(running);
                    return Poll::Pending;
                }
                Poll::Ready(result) => {
                    self.settle(running.label, running.resolver, result);
                    cx.waker().wake_by_ref();
                    return Poll::Pending;
                }
            }
        }
        let Some(entry) = self.queue.pop_front() else {
            return Poll::Ready(());
        };
        match process(entry.payload) {
            Err(error) => self.settle(entry.label, entry.resolver, Err(error)),
            Ok(TickDisposition::Void) => self.settle(entry.label, entry.resolver, Ok(())),
            Ok(TickDisposition::Deferred(completion)) => {
                self.running = Some(Running {
                    label: entry.label,
                    resolver: entry.resolver,
                    completion,
                });
                cx.waker().wake_by_ref();
                return Poll::Pending;
            }
        }
        if self.depth == 0 {
            Poll::Ready(())
        } else {
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

type ProcessFuture<'a, E> = Pin<Box<dyn Future<Output = Result<(), E>> + 'a>>;
type PendingProcess<'a, E> = (ProcessFuture<'a, E>, CompletionResolver<Result<(), E>>);
/// Future-facing StrategyRunner admission. Capture remains synchronous and
/// owned; async processing is pumped on the owning session thread. Void is
/// explicit so callers cannot silently convert a sync callback into async.
pub struct FutureSerialDispatcher<'a, T, E> {
    dispatcher: SerialDispatcher<T, E>,
    futures: VecDeque<PendingProcess<'a, E>>,
}
impl<'a, T, E: Clone> Default for FutureSerialDispatcher<'a, T, E> {
    fn default() -> Self {
        Self::new()
    }
}
impl<'a, T, E: Clone> FutureSerialDispatcher<'a, T, E> {
    pub fn new() -> Self {
        Self {
            dispatcher: SerialDispatcher::new(),
            futures: VecDeque::new(),
        }
    }
    pub fn depth(&self) -> usize {
        self.dispatcher.depth()
    }
    pub fn take_warnings(&mut self) -> Vec<BacklogWarning> {
        self.dispatcher.take_warnings()
    }
    pub fn take_failures(&mut self) -> Vec<(EntryLabel, E)> {
        self.dispatcher.take_failures()
    }
    pub fn submit_tick<K, F>(&mut self, tick: K, capture: F) -> Result<DispatchReceipt<E>, E>
    where
        F: FnOnce(K) -> Result<T, E>,
    {
        self.dispatcher.submit_tick(tick, capture)
    }
    pub fn enqueue(&mut self, label: EntryLabel, payload: T) -> DispatchReceipt<E> {
        self.dispatcher.enqueue(label, payload)
    }
    pub fn poll_ready<F>(&mut self, cx: &mut Context<'_>, process: &mut F) -> Poll<()>
    where
        F: FnMut(T) -> Result<FutureDisposition<'a, E>, E>,
    {
        if let Some((mut future, resolver)) = self.futures.pop_front() {
            match future.as_mut().poll(cx) {
                Poll::Pending => {
                    self.futures.push_front((future, resolver));
                    return Poll::Pending;
                }
                Poll::Ready(result) => {
                    resolver.complete(result);
                }
            }
        }
        let futures = &mut self.futures;
        self.dispatcher.poll_ready(cx, &mut |payload| {
            Ok(match process(payload)? {
                FutureDisposition::Void => TickDisposition::Void,
                FutureDisposition::Deferred(future) => {
                    let (completion, resolver) = Completion::pending();
                    futures.push_back((future, resolver));
                    TickDisposition::Deferred(completion)
                }
            })
        })
    }
    /// The owning-thread executor must also poll frame/feed tasks using their
    /// wakers; awaiting a receipt alone does not drive its dispatcher.
    pub fn drain<'s, F>(
        &'s mut self,
        process: &'s mut F,
    ) -> impl Future<Output = ()> + 's + use<'s, 'a, F, T, E>
    where
        F: FnMut(T) -> Result<FutureDisposition<'a, E>, E> + 's,
    {
        std::future::poll_fn(move |cx| self.poll_ready(cx, process))
    }
}
