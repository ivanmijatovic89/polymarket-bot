use polymarket_runtime::js_async::{eager, js_await};
use std::{
    cell::RefCell,
    future::Future,
    pin::pin,
    rc::Rc,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll, Wake, Waker},
};
#[derive(Default)]
struct Owner(AtomicUsize);
impl Wake for Owner {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
#[test]
fn fulfilled_and_rejected_awaits_suspend_and_keep_original_values() {
    let owner = Arc::new(Owner::default());
    let waker = Waker::from(owner.clone());
    let mut cx = Context::from_waker(&waker);
    for failed in [false, true] {
        let original: Rc<str> = Rc::from("original callback value");
        let value = original.clone();
        let future = js_await(async move {
            if failed {
                Err(value)
            } else {
                Ok(value)
            }
        });
        let mut future = pin!(future);
        assert!(future.as_mut().poll(&mut cx).is_pending());
        let Poll::Ready(result) = future.as_mut().poll(&mut cx) else {
            panic!("next continuation must settle")
        };
        let actual = match result {
            Ok(value) | Err(value) => value,
        };
        assert!(Rc::ptr_eq(&actual, &original));
    }
    assert!(owner.0.load(Ordering::SeqCst) >= 2);
}
#[test]
fn eager_prefix_does_not_resume_ready_await_in_immediate_caller_poll() {
    let trace = Rc::new(RefCell::new(Vec::new()));
    let captured = trace.clone();
    let future = eager(async move {
        captured.borrow_mut().push("prefix");
        js_await(std::future::ready(())).await;
        captured.borrow_mut().push("continuation");
        7
    });
    assert_eq!(*trace.borrow(), ["prefix"]);
    let owner = Arc::new(Owner::default());
    let waker = Waker::from(owner.clone());
    let mut cx = Context::from_waker(&waker);
    let mut future = pin!(future);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert_eq!(*trace.borrow(), ["prefix"]);
    assert!(owner.0.load(Ordering::SeqCst) > 0);
    assert_eq!(future.as_mut().poll(&mut cx), Poll::Ready(7));
    assert_eq!(*trace.borrow(), ["prefix", "continuation"]);
}
#[derive(Default)]
struct Gate {
    ready: bool,
    waker: Option<Waker>,
}
struct Waiting(Arc<Mutex<Gate>>);
impl Future for Waiting {
    type Output = ();
    fn poll(self: std::pin::Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let mut gate = self.0.lock().unwrap();
        if gate.ready {
            Poll::Ready(())
        } else {
            gate.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
#[test]
fn wake_between_invocation_and_owner_registration_is_forwarded() {
    let gate = Arc::new(Mutex::new(Gate::default()));
    let future = eager(Waiting(gate.clone()));
    let wake = {
        let mut value = gate.lock().unwrap();
        value.ready = true;
        value.waker.take().unwrap()
    };
    wake.wake();
    let owner = Arc::new(Owner::default());
    let waker = Waker::from(owner.clone());
    let mut cx = Context::from_waker(&waker);
    let mut future = pin!(future);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert!(owner.0.load(Ordering::SeqCst) > 0);
    assert!(future.as_mut().poll(&mut cx).is_ready());
}
#[test]
fn pending_inner_await_keeps_its_waker_then_defers_resolved_output() {
    let gate = Arc::new(Mutex::new(Gate::default()));
    let mut future = pin!(js_await(Waiting(gate.clone())));
    let owner = Arc::new(Owner::default());
    let waker = Waker::from(owner.clone());
    let mut cx = Context::from_waker(&waker);
    assert!(future.as_mut().poll(&mut cx).is_pending());
    let wake = {
        let mut value = gate.lock().unwrap();
        value.ready = true;
        value.waker.take().unwrap()
    };
    wake.wake();
    assert!(future.as_mut().poll(&mut cx).is_pending());
    assert!(future.as_mut().poll(&mut cx).is_ready());
}
#[test]
fn completed_eager_prefix_is_immediate_and_outer_await_still_defers() {
    let original = Rc::new(123);
    let value = original.clone();
    let mut future = pin!(js_await(eager(async move { value })));
    let mut cx = Context::from_waker(Waker::noop());
    assert!(future.as_mut().poll(&mut cx).is_pending());
    let Poll::Ready(actual) = future.as_mut().poll(&mut cx) else {
        panic!("next continuation settles")
    };
    assert!(Rc::ptr_eq(&actual, &original));
}
