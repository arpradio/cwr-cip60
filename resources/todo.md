TODO: Metadata Mapping + Registration Pipeline
A technical roadmap for building a deterministic, auditable metadata‑conversion pipeline from CIP‑60 → CWR → DDEX → PROs/MLC/HFA/Foreign Societies.

1. Define Canonical Data Model
   1.1 Normalize CIP‑60 Input
   [ ] Extract Work entity

Title

Alternate titles

Writers

Publishers

Splits

Agreements

ISWC (if known)

Internal Work UUID

[ ] Extract Recording entity

ISRC

Recording title

Artist

Label

Release date

[ ] Extract Relationships

Work ↔ Recording

Writer ↔ Work

Publisher ↔ Work

Performer ↔ Recording

1.2 Create JSON Schema
[ ] Define work.json

[ ] Define recording.json

[ ] Define party.json (writers, publishers, sub‑publishers)

[ ] Define relationship.json

2. Build Transformation Layer
   2.1 CIP‑60 → Internal Normalized Model
   [ ] Write parser for CIP‑60 JSON

[ ] Validate required fields

[ ] Normalize roles (composer, lyricist, arranger, etc.)

[ ] Normalize splits (ensure 100%)

[ ] Normalize identifiers (IPI, ISWC, ISRC)

2.2 Internal Model → CWR
[ ] Implement mapping functions for:

[ ] Work identity → NWR

[ ] Writers → SPU

[ ] Publishers → SPU

[ ] Sub‑publishers → SPU

[ ] Recordings → REC

[ ] Agreements → AGR

[ ] Implement CWR formatting rules:

Fixed‑width fields

Uppercase normalization

Territory codes

IPI formatting

ISWC formatting

[ ] Generate CWR batch file

[ ] Validate against CWR spec

2.3 Internal Model → DDEX (MWN)
[ ] Implement XML generator

[ ] Map CWR‑equivalent fields to DDEX:

WorkTitle

MusicalWorkId

Writer → WriterId

Publisher → PublisherId

SoundRecordingId

ResourceTitle

Artist

[ ] Validate against MWN XSD schema

3. Build Submission Layer
   3.1 PRO Registration (ASCAP/BMI/SESAC/GMR)
   [ ] Export CWR batch

[ ] Upload via society portal or SFTP

[ ] Store submission receipts

[ ] Store assigned ISWC (when returned)

3.2 MLC Registration
[ ] Export DDEX MWN

[ ] Submit via MLC portal or API (if available)

[ ] Validate ISRC ↔ ISWC alignment

[ ] Store MLC Work IDs

3.3 HFA Registration
[ ] Determine ingestion method (MWN or portal)

[ ] Submit MWN or manual entry

[ ] Store HFA Work IDs

3.4 Foreign Societies
[ ] Determine society preference (CWR vs DDEX)

[ ] Generate appropriate format

[ ] Submit via sub‑publisher or direct

4. Build Reconciliation Layer
   4.1 PRO Feedback
   [ ] Parse CWR acknowledgements

[ ] Capture ISWC assignments

[ ] Detect conflicts (title, splits, IPIs)

4.2 MLC Feedback
[ ] Pull unmatched works

[ ] Pull conflict reports

[ ] Resolve ISRC/ISWC mismatches

4.3 DSP Metadata Alignment
[ ] Compare distributor metadata vs canonical model

[ ] Detect title mismatches

[ ] Detect artist mismatches

[ ] Detect ISRC inconsistencies

5. Build Audit + Logging
   5.1 Versioning
   [ ] Version every CIP‑60 input

[ ] Version every CWR export

[ ] Version every DDEX export

5.2 Hashing
[ ] Hash each work entity

[ ] Hash each recording entity

[ ] Hash each submission payload

5.3 Ledger
[ ] Maintain immutable log of:

Submissions

Acknowledgements

ISWC assignments

MLC matches

HFA matches

6. Build CLI + API
   6.1 CLI Commands
   [ ] cip60 normalize <file>

[ ] cip60 to-cwr <file>

[ ] cip60 to-ddex <file>

[ ] cip60 submit-pro <file>

[ ] cip60 submit-mlc <file>

6.2 API Endpoints
[ ] /normalize

[ ] /export/cwr

[ ] /export/ddex

[ ] /submit/pro

[ ] /submit/mlc

7. Build Testing Framework
   7.1 Unit Tests
   [ ] Field‑level mapping tests

[ ] Split validation tests

[ ] Identifier formatting tests

7.2 Integration Tests
[ ] CIP‑60 → CWR end‑to‑end

[ ] CIP‑60 → DDEX end‑to‑end

[ ] CWR → PRO acceptance tests

[ ] DDEX → MLC acceptance tests

7.3 Golden Files
[ ] Store known‑good CWR examples

[ ] Store known‑good DDEX examples

8. Deployment
   8.1 Containerization
   [ ] Dockerfile

[ ] CI/CD pipeline

8.2 Environment Setup
[ ] Secrets for PRO/MLC/HFA submissions

[ ] SFTP keys

[ ] API tokens

9. Documentation
   9.1 Developer Docs
   [ ] Mapping specification

[ ] Schema definitions

[ ] Transformation rules

9.2 Operator Docs
[ ] How to submit CWR

[ ] How to submit DDEX

[ ] How to reconcile mismatches
