//! Owning-thread primitives for JavaScript async call and await boundaries.
//! A woken continuation MUST be polled in a later owner turn, never recursively
//! in the same turn. These primitives preserve eager prefixes and resolved-value
//! identity; they do not certify every nested ECMAScript Promise job layer.
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
};

#[derive(Default)]
struct WakeState {
    target: Option<Waker>,
    notified: bool,
}
#[derive(Default)]
struct ForwardWake(Mutex<WakeState>);
impl ForwardWake {
    fn notify(&self) {
        let target = {
            let mut state = self.0.lock().expect("async forwarding waker poisoned");
            state.notified = true;
            state.target.clone()
        };
        // Never invoke an executor while holding the forwarding lock.
        if let Some(target) = target {
            target.wake();
        }
    }
    fn install(&self, target: &Waker) {
        let notified = {
            let mut state = self.0.lock().expect("async forwarding waker poisoned");
            state.target = Some(target.clone());
            std::mem::take(&mut state.notified)
        };
        if notified {
            target.wake_by_ref();
        }
    }
    fn clear(&self) {
        self.0
            .lock()
            .expect("async forwarding waker poisoned")
            .target = None;
    }
}
impl Wake for ForwardWake {
    fn wake(self: Arc<Self>) {
        self.notify();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.notify();
    }
}

/// Run an async function's prefix at invocation, as JavaScript does. A prefix
/// that suspends cannot resume during the first caller poll: that poll registers
/// the actual owner waker and schedules a later continuation. Values/errors are
/// moved unchanged, including session-local object/reference handles.
pub fn eager<F: Future>(future: F) -> EagerFuture<F> {
    let forwarding = Arc::new(ForwardWake::default());
    let waker = Waker::from(forwarding.clone());
    let mut context = Context::from_waker(&waker);
    let mut future = Box::pin(future);
    let (ready, suspended_prefix) = match future.as_mut().poll(&mut context) {
        Poll::Ready(value) => (Some(value), false),
        Poll::Pending => (None, true),
    };
    EagerFuture {
        future: Some(future),
        ready,
        suspended_prefix,
        forwarding,
        complete: false,
    }
}
pub struct EagerFuture<F: Future> {
    future: Option<Pin<Box<F>>>,
    ready: Option<F::Output>,
    suspended_prefix: bool,
    forwarding: Arc<ForwardWake>,
    complete: bool,
}
// The inner future is pinned in its own allocation. Moving its owned output or
// the wrapper never moves that allocation.
impl<F: Future> Unpin for EagerFuture<F> {}
impl<F: Future> Future for EagerFuture<F> {
    type Output = F::Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        assert!(!this.complete, "completed eager future polled again");
        if let Some(value) = this.ready.take() {
            this.complete = true;
            this.future = None;
            this.forwarding.clear();
            return Poll::Ready(value);
        }
        this.forwarding.install(cx.waker());
        if std::mem::take(&mut this.suspended_prefix) {
            // The eager invocation already polled the async prefix. Do not
            // resume its first await in the caller's immediate poll.
            cx.waker().wake_by_ref();
            return Poll::Pending;
        }
        let waker = Waker::from(this.forwarding.clone());
        let mut forwarded = Context::from_waker(&waker);
        match this
            .future
            .as_mut()
            .expect("pending eager future")
            .as_mut()
            .poll(&mut forwarded)
        {
            Poll::Pending => Poll::Pending,
            Poll::Ready(value) => {
                this.complete = true;
                this.future = None;
                this.forwarding.clear();
                Poll::Ready(value)
            }
        }
    }
}
impl<F: Future> Drop for EagerFuture<F> {
    fn drop(&mut self) {
        self.forwarding.clear();
    }
}

/// Awaiting even an already fulfilled/rejected JS Promise schedules a later
/// continuation. This wrapper retains the exact output, yields once when the
/// inner future resolves, and returns that output in the next owner turn.
pub fn js_await<F: Future>(future: F) -> JsAwait<F> {
    JsAwait {
        future: Some(Box::pin(future)),
        ready: None,
        complete: false,
    }
}
pub struct JsAwait<F: Future> {
    future: Option<Pin<Box<F>>>,
    ready: Option<F::Output>,
    complete: bool,
}
impl<F: Future> Unpin for JsAwait<F> {}
impl<F: Future> Future for JsAwait<F> {
    type Output = F::Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        assert!(!this.complete, "completed JS await polled again");
        if let Some(value) = this.ready.take() {
            this.complete = true;
            return Poll::Ready(value);
        }
        match this
            .future
            .as_mut()
            .expect("pending JS await")
            .as_mut()
            .poll(cx)
        {
            Poll::Pending => Poll::Pending,
            Poll::Ready(value) => {
                this.ready = Some(value);
                this.future = None;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }
}
