# Project Constitution

> The single authoritative source of project constraints, standards, and architectural rules.
> Managed by SpecFuse. Sections inside `<!-- specfuse:*:start/end -->` are auto-generated.
> Add your own rules in the non-managed sections below.

---

## Core Principles

*(Add your project's guiding principles here)*

## Technical Constraints

*(Add technical constraints here — not covered by architecture or PRD)*

## Code Standards

*(Code quality, naming conventions, test coverage thresholds, style rules)*

## Security Rules

*(Authentication, secrets management, input validation, data handling)*

## Performance Budgets

*(Page load targets, API latency, bundle size limits)*

---

## [SpecFuse Managed] plan-decisions

<!-- specfuse:plan-decisions:start -->
> Auto-synced from `.specfuse/plan/architecture.md` by SpecFuse on 2026-05-20

### From: Architectural Decisions

- **[Architectural Decisions]** *(e.g. Microservices over monolith because X)*
- **[Architectural Decisions]** *(e.g. Event-driven for async operations)*
- **[Architectural Decisions]** *(e.g. REST APIs for all synchronous communication)*

### From: Tech Stack

- **[Tech Stack]** **Runtime:** *(e.g. Node.js 20 LTS)*
- **[Tech Stack]** **Database:** *(e.g. PostgreSQL 15 — one schema per service)*
- **[Tech Stack]** **Cache:** *(e.g. Redis 7)*
- **[Tech Stack]** **Message queue:** *(e.g. RabbitMQ)*
- **[Tech Stack]** **Container:** *(e.g. Docker + Kubernetes)*

### From: Constraints

- **[Constraints]** *(Non-negotiable technical rules)*
- **[Constraints]** *(Performance budgets)*
- **[Constraints]** *(Compatibility requirements)*

### From: Security

- **[Security]** *(Authentication strategy)*
- **[Security]** *(Secrets management — e.g. no env vars, use Vault)*
- **[Security]** *(Transport encryption — e.g. TLS 1.3+)*
- **[Security]** *(Input validation requirements)*
<!-- specfuse:plan-decisions:end -->

---

## [SpecFuse Managed] plan-prd

<!-- specfuse:plan-prd:start -->
> Auto-synced from `.specfuse/plan/prd.md` by SpecFuse on 2026-05-20

### From: Non-Functional Requirements

- **[Non-Functional Requirements]** **Availability:** 99.9% uptime SLA
- **[Non-Functional Requirements]** **Performance:** P95 response time < 200ms
- **[Non-Functional Requirements]** **Scalability:** Support N concurrent users
- **[Non-Functional Requirements]** **Compliance:** *(e.g. GDPR, SOC 2, HIPAA)*

### From: Technical Constraints

- **[Technical Constraints]** *(Deployment target — e.g. AWS, GCP, on-prem)*
- **[Technical Constraints]** *(External systems to integrate with)*
- **[Technical Constraints]** *(Existing systems that must not be broken)*

### From: Tech Stack

- **[Tech Stack]** **Runtime:** *(e.g. Node.js 20 LTS)*
- **[Tech Stack]** **Database:** *(e.g. PostgreSQL 15)*
- **[Tech Stack]** **Infrastructure:** *(e.g. Docker + Kubernetes)*
<!-- specfuse:plan-prd:end -->
