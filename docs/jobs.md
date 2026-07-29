# Jobs and retries

Persist a bounded plan. Retry observations. Never guess after an uncertain write.

The local job queue stores action plans, checkpoints, attempts, status, and failure state in deployment-owned JSON.

Public manual: https://cockroachbrowser.com/docs/jobs/

## Queue a finite plan

Each job belongs to one session and contains a finite action list. The queue persists before and after execution so a restart can inspect the last completed checkpoint.

## Retry only safe observations

Automatic retry is limited to read-like operations such as snapshots, waits, and extraction. Navigation and mutations may have produced an external effect even when the client missed the response. Unknown results stop for review.

## Use idempotency above the browser

Maqam and application services should carry stable operation IDs through policy, browser execution, downstream writes, and receipts. Cross-ledger writes are not one transaction, so use an explicit outbox and reconcile by ID.

## Durability scope

The built-in queue is process-local and file-backed. It is useful for one owned worker. Distributed scheduling, signed webhooks, and team session control remain planned capabilities.


## Release status

This manual targets Cockroach Browser 0.1.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
