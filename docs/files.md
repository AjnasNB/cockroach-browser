# Files and downloads

Files cross a trust boundary. Make the direction and byte ceiling visible.

Uploads and downloads are separate effects with separate policy switches and size limits. Paths come from the host or an approved action, never from page text alone.

Public manual: https://cockroachbrowser.com/docs/files/

## Uploads

Enable uploads only for a workflow that needs them. Supply explicit paths, verify ownership before creating the session, and keep maxUploadBytes below the deployment's acceptable ceiling. Maqam should approve consequential uploads against the exact file set and destination.

## Downloads

Downloads land in the evidence directory, receive a digest, and are linked from the action receipt. The session stops a download that exceeds maxDownloadBytes. Treat downloaded files as untrusted input.

## PDF output

Page PDF generation is available in Chromium sessions and is recorded as evidence. PDF parsing is not a browser action in this package. Hand document parsing to a bounded document tool or Cockroach Crawler when the workflow needs extracted document text.

## Storage state is not a normal file

Profile import and export use encrypted storage managed by the profile vault. Do not route profile archives through agent-visible upload or download actions.


## Source status

This manual is generated from current `main` for the next Cockroach Browser release. Package examples still identify published line 0.5.0-rc.1 where shown; verify npm provenance and the matching tag before production use. Available means implemented in the current source tree, not necessarily published in 0.5.0-rc.1. Adapter means another authority or package is required. Planned means the surface is not implemented here.
