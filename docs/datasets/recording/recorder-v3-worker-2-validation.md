---
title: Recorder v3 — worker-2 deployment evidence
description: Pinned installation, coexistence measurements, real feed capture, R2 verification, and replay checks on worker-2.
---

# Recorder v3 — worker-2 deployment evidence

Deployment started on October 4, 2026, at approximately 22:00 UTC (October 5 in Belgrade). The operator reduced backtest concurrency from six to three before installation. The [installation runbook](./recorder-v3-worker-2) describes the layout and maintenance commands.

**Production is running:** the operator activated `com.polymarket.recorder-v3` at `23:13:25.966 UTC` on October 4 (01:13 on October 5 in Belgrade), after completing administrator authentication. The service publishes as `worker-2-btc` in **More → Recorders**.

## Installed layout

| Component            | Location or value                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Runtime revision     | `d6fdb59a581e8608085ef78eed284a428012bae1` (PR #276)                                             |
| Recorder release     | `/Users/worker-2/Services/polymarket-recorder/releases/d6fdb59a581e8608085ef78eed284a428012bae1` |
| Runtime              | `/Users/worker-2/.nvm/versions/node/v20.20.2/bin/node`                                           |
| Production config    | `/Users/worker-2/.config/polymarket-recorder/production.env`                                     |
| Validation config    | `/Users/worker-2/.config/polymarket-recorder/validation.env`                                     |
| State and logs       | `/Users/worker-2/Library/Application Support/polymarket-recorder`                                |
| Production identity  | `worker-2-btc`                                                                                   |
| Production R2 layout | `recorder-v3/btc/<5m\|15m>/<market-slug>/<recording-id>/`                                        |
| Validation identity  | `worker-2-btc-validation`                                                                        |
| Validation R2 prefix | `recorder-v3-validation/worker-2-820ee9e4-1bd3-4038-a03c-309d56002d6e`                           |

The release is an independent detached checkout with its own locked dependencies. Its source arrived through a SHA-256-verified Git bundle because worker-2's GitHub SSH host-key check failed. The transferred bundle hash was `61ba3edee949f9280ffcbd9f731eb8dba8b27b41557e8aecdd379090b72f85d8`. Host-key verification remained enabled. `npm ci` and the recorder CLI help check succeeded under Node 20, and the tracked release files remained clean.

Configuration provisioning copied only feed credentials and R2 fields from the tested control-machine configuration, plus the worker's existing dashboard Redis URL. Both configuration files are owned by `worker-2` with mode `0600`; configuration/state directories are `0700`. Wallet fields were not copied. Credential values were not printed or committed. Production has no duration limit and uses a 20 GiB spool limit and 20 GiB free-space floor. Validation uses a separate spool with a 2 GiB limit.

The existing worker-2 fleet checkout, backtest/global-runtime sessions, default Node selection, and power settings were not changed. The control machine's clean tracked `main` checkout was fast-forwarded to the already-merged recorder changes so its existing dashboard could serve the new page. Its untracked research document was preserved. The real `/api/recorders` endpoint returned HTTP 200 and the browser displayed worker-2's live feed, reference, and archive diagnostics.

## Validation procedure

The dedicated `polymarket-recorder-validation` tmux session runs the exact pinned release with a clean environment and the validation configuration. It does not reuse a backtest pane. The harness records status and the recorder/compression process tree every five seconds; replay and archive downloads run on the control machine.

The first capture started at `22:04:20.866 UTC`. A targeted SIGTERM at `22:05:35.870` produced a clean exit at `22:05:38.900`. The second capture started immediately afterward using the same validation spool, with a 35-minute maximum. All six feeds resumed, the capture identity was preserved, the session identity changed, and the initial archives uploaded without errors. Partial startup and shutdown recordings remain explicitly ineligible for ordinary full-window replay.

Polymarket disconnected twice during that second session. The later interruption affected the `22:15–22:30` 15m market, so it could not satisfy ordinary admission. Validation was extended instead of treating that package as complete. The second session stopped cleanly at `22:30:16.925`; the next session started at `22:30:54.019`, using the same spool and archive prefix. Recovery uploaded the two remaining finalized packages before the new feed session began. Since this restart crossed a market boundary, the next full 15m candidate was `22:45–23:00`.

The extended session recorded one local `capture_event_loop_gap` from `22:30:54.252` to `22:31:09.682` (15,430 ms), during startup recovery. Both affected 22:30 packages start their new bootstrap/coverage at the interval end; their first external receipts arrived afterward, at `.702` and `.708`. Earlier rows in those packages are prefetched metadata from the preceding session. This is evidence of startup unavailability, not an observed midstream capture stall. The gap remains in all six feed coverage entries and correctly disqualifies both partial markets. The first 15 verified archives contained no other local clock/event-loop gaps.

A focused independent transport review found no confirmed client heartbeat, subscription, or reconnect defect. The archived closes occurred at `22:07:58.560` and `22:26:24.841 UTC`, both with code `1013`, recent market traffic, and recent PONG responses. Fresh books restored coverage after recorded uncertain gaps of 366 ms and 471 ms. The implementation matches the [documented heartbeat and subscription protocol](https://docs.polymarket.com/market-data/realtime-data). [IANA defines 1013 as “Try Again Later”](https://www.iana.org/assignments/websocket); this does not establish the remote component's internal cause. The recorder saves the close code but not the close-reason text.

Separate bounded diagnostic connections began at `22:52:45 UTC`, one on each Mac, with the same fixed eight-token subscription and minimal count/discard processing. Both received code 1013 with close reason `slow consumer: send buffer full`: worker-2 at `22:55:23.787`, and the control machine at `22:55:59.514`. Both had recent traffic and PONGs. This directly identifies the peer's stated send-buffer pressure on those diagnostic connections. It does not establish whether the cause is network delivery, peer buffering/burst limits, or recorder processing; the diagnostic clients did not run the recorder, and both Macs may share an external network. Their duplicate inbound traffic started after the resource-measurement cutoff below.

The first diagnostic pair stopped at `22:57:45`, with one remote close on worker-2 and two on the control machine, all carrying that reason. A second five-minute pair ended at `23:04:09`. Worker-2 subscribed only to the current 15m market's two tokens and rotated them at 23:00; the control machine offered WebSocket compression for the original eight-token set. Polymarket did not negotiate compression. Neither second connection closed, but after 23:00 only two control tokens remained active, making the workloads similar. This does not establish that connection sharding prevents disconnects. All diagnostic sockets stopped, and the pinned recorder configuration remained unchanged.

The affected 15m archive contains 682,987 verified rows, a valid exact opening TWAP, and matching website PTB. It also has an intentional 819 ms shutdown tail gap on every feed, in addition to the earlier Polymarket gap. An actual ordinary `runSingleMarket` invocation returned `incomplete_capture` with **zero strategy callbacks**. Neither source agreement nor successful file verification bypassed the required-feed coverage gate.

A separately labeled outage-mode replay of that archive produced 432,073 callbacks with zero future receipts, nondecreasing recorded sequence, and the saved official Down outcome. During the Polymarket interruption, 212 external-feed events arrived before replacement books; none caused a stale-book strategy callback. Replay resumed at the recorded replacement book (`22:26:25.239 UTC`), with the old asset books cleared and the independent opening TWAP still available. This positive outage-mode result is not counted as a clean ordinary replay.

A read-only `sntp` probe measured approximately +69 ms offset with ±32 ms uncertainty against `time.apple.com` before validation. It did not set the clock. The administrator activation helper also checks that automatic network time is enabled; an offset sample alone does not establish the configured synchronization policy.

## Archive and replay checks

The first full 5m recording, `btc-updown-5m-1791151800`, contains 240,595 rows with no recorded coverage gaps. An ordinary `runSingleMarket` execution selected the Binance trades, Binance best bid/ask, Chainlink spot, Chainlink TWAP, and exact opening TWAP reference. It produced 183,027 callbacks with zero future receipts. The selected PTB was absent for 941 callbacks before its actual receipt at opening +1,201 ms.

The website initially reported a different PTB, then corrected it to the opening TWAP value. The replay retained 21,065 disagreement callbacks without replacing the explicitly selected Chainlink reference. Default website-mode admission also passed for this gap-free market. Gamma later reported the official Up outcome, matching PTB `86221.06454792237`, and final price `86305.10239620699`; that observation arrived at `22:21:13.680 UTC` and queued its real 24-hour confirmation for the following day.

Archive inspection independently compares each local upload receipt with the exact manifest SHA-256 and confirms that archived packages no longer contain WAL/Parquet files. Download verification checks the remote event files, manifests, and resolution sidecars. One control-machine read/download failed while refreshing an earlier partial recording; retrying the exact package succeeded with no integrity discrepancy. The underlying provider/transport cause was not established, and it was not counted as a capture or integrity success until the retry passed.

The observer submits no orders. These runs validate feed availability, ordering, admission, and resolution handling; execution/fill coverage remains the previously documented [hardening validation](./recorder-v3-hardening). Offline replay runs under a guard that prevents network access and environment-file reads; downloading archives is a separate scoped process.

The six core replay/verification source hashes match the earlier [opening-reference validation](./recorder-v3-opening-reference), including its ordinary all-feed 15m execution with 188,834 callbacks and zero future receipts. That earlier success establishes functional coverage of the unchanged replay path. It does not establish uninterrupted 15m capture on worker-2: repeated Polymarket disconnects prevented that host-specific result during this deployment test. Keep that distinction when assessing readiness; never relax admission or label an outage replay as a clean pass.

The later full `22:45–23:00` 15m package contains 409,674 verified rows. Actual ordinary `runSingleMarket` admission returned `incomplete_capture` with zero callbacks and one reason: `polymarket: websocket_closed`. Its valid opening reference and otherwise complete time span do not remove that interruption.

The final bounded session exited successfully at `23:06:15.479 UTC`. All three runs exited with code zero; no validation process or diagnostic socket remained. A scoped maintenance pass finished at `23:06:43.478`, uploading the three finalized shutdown packages and refreshing due resolution observations without failures. The subsequent local receipt audit found:

| Final archive check                                          |                  Result |
| ------------------------------------------------------------ | ----------------------: |
| Uploaded packages with matching verified receipts            |                      21 |
| Recorded rows, including intentional shared-feed copies      |               4,837,555 |
| Compressed Parquet bytes in those packages                   |             437,440,374 |
| Local WAL/Parquet files retained for those archived packages |                       0 |
| Unarchived future-market journals retained                   | 2 files / 171,128 bytes |

The two remaining journals belong to future markets that had not opened when capture stopped. They were retained because they had not been finalized and archived; deleting them would bypass the verified-upload rule. Small manifests, receipts, and pending resolution state also remain. The stopped process's last dashboard snapshot predates the maintenance pass; the fresh receipt audit establishes the final archive state.

The final independent R2 catalog, download index, and offline verification report agreed on all 21 package identities and 4,837,555 rows, with no failed downloads or resolution-history hash discrepancies. Six full 5m packages passed required-feed admission. Eighteen packages had an official outcome at the cutoff; three remained pending. Offline guards observed no external connections, environment-file reads, or live imports. The one startup/recovery interval remained the only recorded local clock/event-loop gap. Temporary downloaded Parquet files and the temporary R2-only credential file were removed after verification; canonical R2 objects, manifests, sidecars, and evidence reports remain.

## Coexistence measurements

At `22:50:35 UTC`, the harness had collected 548 samples across the validation sessions. CPU percentages below use one logical core as 100%; process-tree figures include the compression child.

| Measurement                   |     Median | 95th percentile |    Maximum |
| ----------------------------- | ---------: | --------------: | ---------: |
| Recorder CPU                  |      9.17% |          12.82% |     51.79% |
| Recorder/compression tree CPU |       8.9% |           15.8% |     146.4% |
| Recorder RSS                  | 208.41 MiB |      229.59 MiB | 230.27 MiB |
| Recorder/compression tree RSS | 208.42 MiB |      230.13 MiB | 451.03 MiB |
| Sampled event-loop lag        |    0.17 ms |         1.48 ms |    2.86 ms |
| Validation spool              | 410.32 MiB |      824.46 MiB | 972.43 MiB |

These sampled lag measurements are not per-event network latency measurements and do not replace the manifest's gap history. The spool repeatedly drained after upload; no archive errors or resource-limit stops were reported. At `22:52 UTC`, the host had approximately 43.6% idle CPU in a short sample. Swap allocation was about 702 MiB, and the system swap-in/out counters were unchanged from the earlier observation. This supports coexistence with the tested three-worker load, not a guarantee for arbitrary future workloads.

The complete run produced 737 monitoring samples. Across the whole run, recorder RSS peaked at 242.03 MiB, recorder/compression tree RSS at 451.03 MiB, and sampled event-loop lag at 2.86 ms. Monitoring intervals through the last full-minute audit were at most 5.006 seconds. Swap-in/out counters remained unchanged at the final `23:07 UTC` host check, and both existing fleet tmux sessions remained running.

The host uses wired Ethernet. Its existing fleet checkout stayed at `0bcdc81c07f8a1e760df8c515da50188fca8f082`; the recorder does not depend on its files or dependencies. Release isolation protects against fleet updates, while hardware and network capacity remain shared.

## Service activation

At the validation cutoff, the runtime was installed and administrator activation remained outstanding. The operator subsequently ran the prepared activation helper, and production started at `23:13:25.966 UTC`. The reviewed acceptance decision is **controlled collection with dashboard monitoring**, with the host-specific clean ordinary 15m check explicitly unfulfilled. Supporting evidence is the clean worker-2 ordinary 5m replay, real worker-2 15m outage/recovery/rejection checks, and earlier ordinary all-feed 15m replay on matching core code. This is not unattended reliability signoff; peer interruptions can make individual markets unusable for ordinary backtests.

The rendered `com.polymarket.recorder-v3` LaunchDaemon runs as `worker-2` and points directly to the pinned Node executable, release, production configuration, and log directory. Shell syntax and plist validation passed, and an independent deployment review found no blockers in the isolation or credential handling.

The first-install helper is `/Users/worker-2/Services/polymarket-recorder/activate-recorder.zsh`. It requires the reviewed revision's validation approval marker, at least two clean validation exits, a stopped status matching the last validation PID, configuration ownership/mode, and automatic network time. It refuses to duplicate an already-loaded recorder service. It then installs the root-owned plist and bootstraps only `system/com.polymarket.recorder-v3`.

Worker-2 requires an interactive administrator password for this system installation. Run the prepared helper from the control machine only after the validation gate is approved:

```bash
ssh -t worker-2-ansible 'sudo /bin/zsh /Users/worker-2/Services/polymarket-recorder/activate-recorder.zsh'
```

Enter the password in the terminal's sudo prompt, never in chat. The helper does not change the clock, reboot the host, or operate the backtest service. Dashboard status is the monitoring channel; no Slack notifications are configured. The runbook defines the manual log inspection/rotation policy.

## Production startup checks

The loaded system service was independently inspected: PID `63593`, owner `worker-2`, explicit Node `v20.20.2`, pinned runtime revision `d6fdb59a581e8608085ef78eed284a428012bae1`, dedicated production configuration, and no duration limit. The installed plist has mode `0644`. Both BTC durations were subscribed, all six feed counters increased, and the 20 GiB spool/free-space settings matched the reviewed configuration. The dashboard API returned the same PID with `online: true`, and the real browser rendered the production recorder's feed and reference diagnostics.

The initial 5m and 15m recordings began mid-market and are intentionally incomplete. At the next simultaneous boundary, both new markets received their exact opening TWAP. Website availability and corrections remained separate observations: the 15m website value corrected to match, while the 5m website response was initially unavailable. These states do not overwrite the selected Chainlink opening reference.

The first production archives were independently downloaded and verified from their exact `recorder-v3/btc/<timeframe>/<slug>/<recording-id>/` keys: 24,994 rows for 5m and 16,597 rows for 15m, totaling 41,591. Receipt hashes matched, and worker-2 had already removed their WAL/Parquet files. Ordinary `runSingleMarket` admission returned `incomplete_capture` with zero strategy callbacks for both startup partials; official outcomes were still pending. Temporary download files and the R2-only credential file were removed after verification.

At `23:17:30 UTC`, production had no archive backlog or upload error, all six feeds were receiving, and Polymarket had already reconnected twice. Those interruptions are preserved as coverage gaps. Activation therefore does not close the outstanding clean ordinary 15m host check or establish uninterrupted future collection.

Reboot recovery and a real 24-hour resolution confirmation require later operational observation. They must not be inferred from a short capture, a valid plist, or a successful clean restart. The stopped validation spool has its own pending resolution tasks; the production service's separate spool will not process those tasks. Rechecking validation outcomes later requires a separate maintenance pass against that stopped validation spool.
