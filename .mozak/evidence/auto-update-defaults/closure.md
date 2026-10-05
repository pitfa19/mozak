# Default-on automatic updates: delivered

Owner request approved 2026-10-05T21:24:06Z. Source commit b47371c, immutable stable tag v0.8.1 at 71d2f0abb01a338ca53d85abe937d965926e8565.

Whole scoped checks: 44 Python unit tests, packaged startup update, default-on archive and bootstrap installs, opt-out/reinstall preservation, MCP no-check, checksum rejection, offline fallback, rollback, shell syntax and documentation all passed. Independent reviewer ant confirmed both findings corrected with no blockers. Follow-up version passed full workspace tests, strict Clippy, formatting and optimized release build, plus repeated v0.8.1 packaged delivery and bootstrap acceptance.

Hosted stable publication 37377084104 and hosted CI 37377083083 both succeeded. GitHub releases/latest returned v0.8.1. Downloaded published archive passed SHA256SUMS. Task 434091z4au installed that exact archive into an empty disposable HOME without enable flags: observed automatic stable updates true, interval 86400, active 0.8.1-71d2f0abb01a and managed setup ready.

The same task invoked the real owner launcher `mozak update --channel stable --enable-auto`: installed published build 0.8.1-71d2f0abb01a under /home/pitfa/.local/bin/mozak, automatic stable updates true, managed setup ready. Prior build remains available for rollback.

MCP startup intentionally does not check updates. CLI startup checks at most every 24 hours, not every invocation. Explicit opt-outs remain honored, including existing false preferences on reinstall. Existing users who opted out are not silently opted in. The owner explicitly opted in here.

Actual publication and fresh/owner status receipts are adjacent. The earlier acceptance-before-publication record is immutable and accurately describes its earlier observation boundary, now superseded by this closure. No changes to frozen v0.8.0, project notes, KBs, recorded research or shared MCP registrations were made by this goal. No blockers remain for the approved Linux x86_64 delivery scope.
