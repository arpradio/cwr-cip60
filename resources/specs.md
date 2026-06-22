# Application Specification: CIP‑60 → CWR → DDEX Registration Pipeline

## 1. Overview

This application will ingest **CIP‑60–style JSON metadata** or CWR, normalize it into a canonical catalog model, and generate/export:

- **CWR** files for PROs and foreign mechanical societies
- **DDEX MWN** (and related) XML for MLC/HFA/others
- Submission payloads + logs for reconciliation and audit

The system must be **deterministic, auditable, and scriptable** (CLI + API).

---

## 2. Goals & Scope

### 2.1 Primary Goals

- [ ] Treat CIP‑60 as the **canonical metadata source**
- [ ] Normalize works, recordings, parties, and relationships
- [ ] Generate **spec‑compliant CWR** from the canonical model
- [ ] Generate **spec‑compliant DDEX MWN** from the canonical model
- [ ] Provide **submission workflows** for PROs, MLC, HFA, and foreign societies
- [ ] Maintain **full audit trail** of all transformations and submissions

### 2.2 Out of Scope (for v1)

- UI dashboard (v1 is CLI/API only)
- Direct SFTP/API integration with all societies (can be stubbed or manual)
- Neighboring rights (SoundExchange) beyond basic metadata export

---

## 3. High‑Level Architecture

### 3.1 Components

- **Ingestion Service**
  - Parses CIP‑60 JSON
  - Validates against CIP‑60 schema
  - Writes to canonical data store

- **Canonical Catalog Service**
  - Stores normalized entities: Works, Recordings, Parties, Relationships
  - Exposes read API for transformation services

- **Transformation Service**
  - `cip60 → canonical`
  - `canonical → CWR`
  - `canonical → DDEX (MWN)`

- **Submission Service**
  - Handles packaging and submission of CWR/DDEX to target entities
  - Stores submission receipts and responses

- **Reconciliation & Audit Service**
  - Ingests acknowledgements/feedback
  - Tracks identifier assignments (ISWC, MLC IDs, etc.)
  - Maintains immutable logs

### 3.2 Tech Stack (proposed)

- **Language:** Python or Node.js (team choice)
- **Storage:** Postgres (canonical catalog + logs)
- **Message Bus (optional):** RabbitMQ/Kafka for async submissions
- **Interfaces:**
  - REST API (FastAPI/Express)
  - CLI (Click/Commander)

---

## 4. Data Model Specification

### 4.1 Canonical Entities

**Work**

- `id` (UUID)
- `title`
- `alternate_titles[]`
- `iswc` (nullable)
- `proprietary_ids[]` (per society)
- `writers[]` (FK → Party)
- `publishers[]` (FK → Party)
- `splits` (writer/publisher shares)
- `agreements[]` (contracts, dates, territories)

**Recording**

- `id` (UUID)
- `title`
- `isrc`
- `artist_name`
- `label`
- `release_date`
- `work_id` (FK → Work)

**Party**

- `id` (UUID)
- `name`
- `type` (writer, publisher, sub‑publisher, label, etc.)
- `ipi` (nullable)
- `cae` (nullable)
- `society_affiliations[]`

**Relationship**

- `id` (UUID)
- `from_id`
- `to_id`
- `type` (e.g., `writer_of`, `publisher_of`, `subpublisher_of`, `recording_of`)

### 4.2 JSON Schemas

- [ ] `schemas/work.json`
- [ ] `schemas/recording.json`
- [ ] `schemas/party.json`
- [ ] `schemas/relationship.json`

Each schema must be strict and used for validation in tests and runtime.

---

## 5. Transformation Specifications

### 5.1 CIP‑60 → Canonical

**Task:** Implement a module that converts CIP‑60 JSON into canonical entities.

- [ ] Map CIP‑60 work fields → `Work`
- [ ] Map CIP‑60 recording fields → `Recording`
- [ ] Map CIP‑60 contributors → `Party` + relationships
- [ ] Normalize roles (composer, lyricist, arranger, etc.)
- [ ] Normalize splits (ensure 100% per work and per right type)
- [ ] Normalize identifiers (IPI, ISWC, ISRC formats)

**Deliverable:**  
`src/transform/cip60_to_canonical.{js,py}`

---

### 5.2 Canonical → CWR

**Task:** Implement a CWR generator from canonical entities.

- [ ] Implement record builders for:
  - NWR (New Work Registration)
  - SPU (Interested Party)
  - REC (Recording)
  - AGR (Agreement)
- [ ] Map fields:
  - Work title, ISWC, proprietary IDs
  - Writer/publisher names, IPIs, roles, shares
  - Sub‑publisher territories and shares
  - Recording ISRC, title, performer
- [ ] Enforce CWR formatting:
  - Fixed‑width fields
  - Uppercase where required
  - Territory codes
  - Checksum/record counts if required by version
- [ ] Support CWR version configuration (e.g., 2.1, 2.2)

**Deliverable:**  
`src/transform/canonical_to_cwr.{js,py}`  
`src/formatters/cwr_writer.{js,py}`

---

### 5.3 Canonical → DDEX (MWN)

**Task:** Implement a DDEX MWN XML generator.

- [ ] Implement XML builder for MWN messages
- [ ] Map fields:
  - WorkTitle, MusicalWorkId (ISWC + proprietary)
  - Writer + WriterId (IPI)
  - Publisher + PublisherId
  - Shares per right type
  - SoundRecordingId (ISRC)
  - ResourceTitle, Artist
- [ ] Validate against official MWN XSD
- [ ] Support configuration for different recipients (MLC, HFA, foreign societies)

**Deliverable:**  
`src/transform/canonical_to_ddex_mwn.{js,py}`  
`src/formatters/ddex_mwn_writer.{js,py}`

---

## 6. Submission Workflows

### 6.1 PROs (ASCAP/BMI/SESAC/GMR)

- [ ] Generate CWR batch file per society
- [ ] Apply society‑specific codes (e.g., society IDs, territory rules)
- [ ] Provide CLI/API to export to a filesystem path
- [ ] (Optional) Integrate SFTP upload
- [ ] Store submission metadata:
  - File hash
  - Timestamp
  - Target society
  - Work IDs included

### 6.2 MLC

- [ ] Generate DDEX MWN payload
- [ ] Provide CLI/API to export XML
- [ ] (Optional) Integrate MLC API if available
- [ ] Store submission metadata and any returned IDs

### 6.3 HFA

- [ ] Support MWN export or CSV/JSON as needed
- [ ] Provide CLI/API for export
- [ ] Store submission metadata

### 6.4 Foreign Societies

- [ ] Configurable per‑society preference: CWR vs DDEX
- [ ] Generate appropriate format
- [ ] Provide export endpoints

---

## 7. Reconciliation & Audit

### 7.1 Feedback Ingestion

- [ ] Define parsers for:
  - CWR acknowledgements (where available)
  - MLC unmatched/conflict reports (CSV/XML)
- [ ] Link feedback to canonical entities via IDs and hashes
- [ ] Store:
  - Assigned ISWC
  - MLC Work IDs
  - Error codes and messages

### 7.2 Audit Trail

- [ ] Log every transformation step with:
  - Input hash
  - Output hash
  - Timestamp
  - Version of mapping code
- [ ] Maintain immutable log table (append‑only)
- [ ] Expose API to query history per work/recording

---

## 8. Interfaces

### 8.1 CLI

Commands (examples):

- `cip60 normalize <input.json> --out canonical.json`
- `cip60 to-cwr <canonical.json> --society ASCAP --out ascap.cwr`
- `cip60 to-ddex-mwn <canonical.json> --recipient MLC --out mlc.xml`
- `cip60 submit-pro --society ASCAP --file ascap.cwr`
- `cip60 submit-mlc --file mlc.xml`

### 8.2 REST API

Endpoints (examples):

- `POST /ingest/cip60` → returns canonical IDs
- `POST /export/cwr` → returns CWR file (or path)
- `POST /export/ddex/mwn` → returns XML
- `POST /submit/pro`
- `POST /submit/mlc`
- `GET /works/{id}/history`

---

## 9. Non‑Functional Requirements

- **Determinism:** Same input → same output (given same config)
- **Traceability:** Every output traceable back to CIP‑60 input and mapping version
- **Testability:** High unit + integration test coverage
- **Configurable:** Society‑specific rules via config, not code changes
- **Security:** Secrets (SFTP/API credentials) stored outside code (env/secret manager)

---

## 10. Testing Strategy

- [ ] Unit tests for all mapping functions (field‑level)
- [ ] Golden‑file tests for CWR and DDEX outputs
- [ ] Integration tests:
  - CIP‑60 → canonical → CWR
  - CIP‑60 → canonical → DDEX MWN
- [ ] Schema validation tests (JSON + XSD)
- [ ] Regression tests for known edge cases (multiple publishers, sub‑publishers, partial IPIs, missing ISWC)

---

## 11. Open Questions / Decisions

- [ ] Final choice of language/runtime (Python vs Node.js)
- [ ] Which CWR version(s) to support initially
- [ ] Which DDEX MWN profile(s) to target first (MLC vs generic)
- [ ] Priority order of societies (ASCAP/BMI vs foreign)
- [ ] Whether to include SoundExchange/neighboring rights in v1
