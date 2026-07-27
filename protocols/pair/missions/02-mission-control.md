# Mission 02 — Mission Control

> status: WAITING — starts after mission 01; the human will fill in his exact
> wants before activation.

## Goal

Build what the HUMAN needs to follow and steer the protocol without reading
raw journals: what is running, what happened, what the results are, and
simple levers to start/stop/redirect.

## What the human wants to see (to be refined by the human)

- Who is alive and what each model is working on right now.
- What was done recently and what came out of it (results, not prose).
- Whether anyone drifted off course.
- Readable from a phone (files on GitHub count).

## What the human wants to control

- Start / stop a model.
- Steer ("stop doing X, try Y") with confirmation that the message was
  received.

## Notes

- The v1 interface in RULES (STATUS.md / INBOX.md / DONE) is the starting
  point — this mission may replace it with a better design, agreed with the
  human.
- Build on what exists (git, the DB, the dashboard on :3051) before
  inventing new infrastructure.

## Done when

The human says he can follow and steer the protocol comfortably. (The human
refines this before activation.)
