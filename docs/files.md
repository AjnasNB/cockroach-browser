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


## Release status

This manual targets Cockroach Browser 0.2.1. Check [the capability matrix](https://cockroachbrowser.com/docs/capabilities/) before relying on a surface. Available means implemented in this release. Adapter means another authority or package is required. Planned means the surface is not part of this release.
